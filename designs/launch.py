#!/usr/bin/env python3
"""Serve the concept collection, plus a phone-friendly controller for Sunroom TV.

The site runs on --port (default 4173). The controller runs on the next port
(default 4174) and drives the Sunroom TV page through a small relay: the
controller posts commands, the TV page receives them as server-sent events,
and the TV's live state flows back the same way.

Both listen only on this computer. If Tailscale is running, the controller
also listens on this computer's Tailscale address, so a phone in the same
tailnet can open it; nothing is opened to other networks.
"""
import argparse
import functools
import http.server
import json
import queue
import subprocess
import threading
from pathlib import Path
from urllib.parse import urlsplit
import webbrowser

ROOT = Path(__file__).resolve().parent
COMMANDS = {  # everything the controller may ask the TV to do
    'press': {'up', 'down', 'left', 'right', 'ok', 'back', 'rep'},
    'event': {'spo2', 'hr', 'overdo', 'still', 'done'},
    'jump': {'home', 'plan', 'band', 'live', 'game', 'summary', 'club'},
    'speed': {'1', '5', '20', '60'},
    'workout': {'walk', 'cycle', 'lift'},
    'profile': {'margaret', 'desmond', 'lin'},
    'sound': None,
    'tap': None,
}


class Hub:
    """Relays controller commands to TV pages and TV state to controllers."""

    def __init__(self):
        self.lock = threading.Lock()
        self.subscribers = {'tv': [], 'controller': []}
        self.state = None

    def subscribe(self, kind):
        q = queue.Queue(maxsize=200)
        with self.lock:
            self.subscribers[kind].append(q)
        return q

    def unsubscribe(self, kind, q):
        with self.lock:
            if q in self.subscribers[kind]:
                self.subscribers[kind].remove(q)

    def publish(self, kind, message):
        with self.lock:
            targets = list(self.subscribers[kind])
        for q in targets:
            try:
                q.put_nowait(message)
            except queue.Full:
                pass


HUB = Hub()


def stream(handler, kind, first=None):
    """Hold the request open as a server-sent event stream."""
    q = HUB.subscribe(kind)
    handler.send_response(200)
    handler.send_header('Content-Type', 'text/event-stream')
    handler.send_header('Cache-Control', 'no-cache')
    handler.end_headers()
    try:
        if first:
            handler.wfile.write(f'data: {first}\n\n'.encode())
            handler.wfile.flush()
        while True:
            try:
                handler.wfile.write(f'data: {q.get(timeout=15)}\n\n'.encode())
            except queue.Empty:
                handler.wfile.write(b': still here\n\n')
            handler.wfile.flush()
    except (BrokenPipeError, ConnectionResetError, OSError):
        pass
    finally:
        HUB.unsubscribe(kind, q)


def read_body(handler, limit=65536):
    length = min(int(handler.headers.get('Content-Length') or 0), limit)
    return handler.rfile.read(length).decode('utf-8', 'replace')


class FreshHandler(http.server.SimpleHTTPRequestHandler):
    """Browsers check for newer files on every load, so a reload always gets the latest code."""

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


class SiteHandler(FreshHandler):
    """The design collection, plus the TV page's side of the relay."""

    def do_GET(self):
        if urlsplit(self.path).path == '/remote/events':
            return stream(self, 'tv')
        super().do_GET()

    def do_POST(self):
        if urlsplit(self.path).path != '/remote/state':
            return self.send_error(404)
        body = read_body(self)
        HUB.state = body
        HUB.publish('controller', body)
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        if '/remote/' not in self.path:  # the TV posts its state twice a second
            super().log_message(fmt, *args)


class ControllerHandler(FreshHandler):
    """The phone controller page and its side of the relay."""

    def do_GET(self):
        if urlsplit(self.path).path == '/events':
            return stream(self, 'controller', HUB.state)
        super().do_GET()

    def do_POST(self):
        if urlsplit(self.path).path != '/command':
            return self.send_error(404)
        try:
            command = json.loads(read_body(self, 4096))
            kind = command.get('type')
            values = COMMANDS[kind]
            if values is not None and str(next(v for k, v in command.items() if k != 'type')) not in values:
                raise ValueError
        except (ValueError, KeyError, TypeError, AttributeError, StopIteration, json.JSONDecodeError):
            return self.send_error(400, 'Unknown command')
        HUB.publish('tv', json.dumps(command))
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        if urlsplit(self.path).path not in ('/command', '/events'):
            super().log_message(fmt, *args)


def tailscale():
    """This computer's Tailscale address and name, if Tailscale is running."""
    try:
        status = json.loads(subprocess.run(['tailscale', 'status', '--json'], capture_output=True,
                                           text=True, timeout=5).stdout)
        me = status['Self']
        ip = next(a for a in me['TailscaleIPs'] if '.' in a)
        return ip, me.get('DNSName', '').rstrip('.')
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, StopIteration, TypeError):
        return None, None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--port', type=int, default=4173, help='site port (default 4173)')
    parser.add_argument('--controller-port', type=int, help='controller port (default: site port + 1)')
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()

    site = http.server.ThreadingHTTPServer(
        ('127.0.0.1', args.port), functools.partial(SiteHandler, directory=str(ROOT)))
    controller_port = args.controller_port or args.port + 1
    controller_handler = functools.partial(ControllerHandler, directory=str(ROOT / 'controller'))
    servers = [site, http.server.ThreadingHTTPServer(('127.0.0.1', controller_port), controller_handler)]
    tailnet_ip, tailnet_name = tailscale()
    if tailnet_ip:
        try:
            servers.append(http.server.ThreadingHTTPServer((tailnet_ip, controller_port), controller_handler))
        except OSError as error:
            print(f'Could not listen on Tailscale ({error}); the controller is on this computer only.', flush=True)
            tailnet_ip = None
    for server in servers:
        server.daemon_threads = True
        threading.Thread(target=server.serve_forever, daemon=True).start()

    url = f'http://localhost:{site.server_port}/'
    print(f'Movement Studio: {url}', flush=True)
    print(f'Controller:      http://localhost:{controller_port}/', flush=True)
    if tailnet_ip:
        print(f'On your phone (Tailscale): http://{tailnet_name or tailnet_ip}:{controller_port}/', flush=True)
        if tailnet_name:
            print(f'                       or: http://{tailnet_ip}:{controller_port}/', flush=True)
    else:
        print('Tailscale is not running, so the controller is on this computer only.', flush=True)
    print('Press Ctrl+C to stop.', flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
    finally:
        for server in servers:
            server.shutdown()


if __name__ == '__main__':
    main()
