#!/usr/bin/env python3
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, unquote

# 脚本所在目录
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 完整 MIME 类型表（含字体、音视频、模型等）
CONTENT_TYPES = {
    # 文本 / 代码
    '.html': 'text/html; charset=utf-8',
    '.htm':  'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.mjs':  'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map':  'application/json; charset=utf-8',
    '.xml':  'application/xml; charset=utf-8',
    '.txt':  'text/plain; charset=utf-8',
    '.csv':  'text/csv; charset=utf-8',
    '.md':   'text/markdown; charset=utf-8',

    # 图片
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.svg':  'image/svg+xml',
    '.webp': 'image/webp',
    '.ico':  'image/x-icon',
    '.bmp':  'image/bmp',
    '.avif': 'image/avif',

    # 字体（关键！）
    '.woff':  'font/woff',
    '.woff2': 'font/woff2',
    '.ttf':   'font/ttf',
    '.otf':   'font/otf',
    '.eot':   'application/vnd.ms-fontobject',

    # 音视频
    '.mp3':  'audio/mpeg',
    '.wav':  'audio/wav',
    '.ogg':  'audio/ogg',
    '.oga':  'audio/ogg',
    '.m4a':  'audio/mp4',
    '.aac':  'audio/aac',
    '.flac': 'audio/flac',
    '.mp4':  'video/mp4',
    '.webm': 'video/webm',
    '.ogv':  'video/ogg',
    '.mov':  'video/quicktime',
    '.m3u8': 'application/vnd.apple.mpegurl',
    '.ts':   'video/mp2t',

    # 二进制 / 模型 / 其他
    '.wasm': 'application/wasm',
    '.glb':  'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.obj':  'model/obj',
    '.stl':  'model/stl',
    '.fbx':  'application/octet-stream',
    '.zip':  'application/zip',
    '.pdf':  'application/pdf',
}


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "SimpleStaticServer/2.0"

    def do_GET(self):
        self._serve(head_only=False)

    def do_HEAD(self):
        self._serve(head_only=True)

    def _serve(self, head_only):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        # 默认首页
        relative_path = "index.html" if path in ("/", "") else path.lstrip("/")

        # 拼接 & 规范化路径
        file_path = os.path.normpath(os.path.join(BASE_DIR, relative_path))

        # 安全检查：防止目录穿越
        if not file_path.startswith(BASE_DIR + os.sep) and file_path != BASE_DIR:
            self._send_error_plain(403, "Forbidden")
            return

        if os.path.isdir(file_path):
            # 目录自动尝试 index.html
            index_path = os.path.join(file_path, "index.html")
            if os.path.isfile(index_path):
                file_path = index_path
            else:
                self._send_error_plain(403, f"Is a directory: {relative_path}")
                return

        if not os.path.isfile(file_path):
            self._send_error_plain(404, f"File not found: {relative_path}")
            return

        ext = os.path.splitext(file_path)[1].lower()
        content_type = CONTENT_TYPES.get(ext, 'application/octet-stream')

        try:
            with open(file_path, 'rb') as f:
                content = f.read()
        except Exception as e:
            self._send_error_plain(500, f"Server error: {e}")
            return

        try:
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            self.send_header('Access-Control-Allow-Origin', '*')
            # 加这个避免某些字体被 CORS 拦
            self.send_header('Cross-Origin-Resource-Policy', 'cross-origin')
            self.end_headers()
            if not head_only:
                self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _send_error_plain(self, code, message):
        body = message.encode('utf-8')
        try:
            self.send_response(code)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, format, *args):
        # 想调试时把下面这行取消注释
        # print("[%s] %s" % (self.address_string(), format % args))
        pass


def run_server(port=8080):
    httpd = None
    for p in range(port, port + 20):
        try:
            httpd = HTTPServer(('', p), RequestHandler)
            port = p
            break
        except OSError as e:
            print(f"端口 {p} 被占用（{e}），试下一个...")
    if httpd is None:
        print("连续 20 个端口都被占用，请手动检查")
        return

    print(f"服务根目录：{BASE_DIR}")
    print(f"服务器已启动：http://127.0.0.1:{port}")
    print(f"手机访问：http://[电脑IP]:{port}")
    print("按 Ctrl+C 停止")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止")
        httpd.server_close()
        

if __name__ == '__main__':
    run_server()