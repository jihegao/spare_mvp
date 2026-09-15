import json
import os
from pathlib import Path
import tempfile
from threading import Thread
import unittest
from unittest.mock import patch
from urllib.request import urlopen

from src.spare_mvp_backend.http_server import create_backend_server

ROOT = Path(__file__).resolve().parents[1]

class PortableAlignmentTest(unittest.TestCase):
    def test_health_and_static_headers_ignore_windows_mime_registry(self):
        with tempfile.TemporaryDirectory() as tmp:
            server = create_backend_server(('127.0.0.1', 0), repo_root=ROOT, output_dir=tmp)
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f'http://127.0.0.1:{server.server_port}'
            try:
                with urlopen(base + '/_spare_mvp/health') as response:
                    self.assertEqual(json.load(response), {'service': 'spare-mvp-backend', 'status': 'ok', 'pid': os.getpid()})
                with patch('mimetypes.guess_type', return_value=('text/plain', None)):
                    for path, mime in [('/front/app.js', 'text/javascript'), ('/front/browser-compat.mjs', 'text/javascript'), ('/front/', 'text/html')]:
                        with urlopen(base + path) as response:
                            self.assertEqual(response.headers.get_content_type(), mime)
                            self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')
                            self.assertEqual(response.headers['Cache-Control'], 'no-cache')
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
