#!/usr/bin/env python3
"""Serve the concept collection locally and open it in the default browser."""
import argparse
import functools
import http.server
from pathlib import Path
import webbrowser


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=4173)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler,
                                directory=str(Path(__file__).resolve().parent))
    with http.server.ThreadingHTTPServer(('127.0.0.1', args.port), handler) as server:
        url = f'http://localhost:{server.server_port}/'
        print(f'Movement Studio: {url}\nPress Ctrl+C to stop.', flush=True)
        if not args.no_browser:
            webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
