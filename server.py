#!/usr/bin/env python3
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, unquote

# 脚本所在目录（自动检测）
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed_path = urlparse(self.path)
        path = unquote(parsed_path.path)

        # 默认页面
        if path == "/" or path == "/index.html":
            relative_path = "index.html"
        else:
            relative_path = path.lstrip("/")

        # 拼接成绝对路径，并规范化
        file_path = os.path.normpath(os.path.join(BASE_DIR, relative_path))

        # 安全检查：确保没有跳出 BASE_DIR
        if not file_path.startswith(BASE_DIR + os.sep) and file_path != BASE_DIR:
            self.send_error(403, "Forbidden")
            return

        # 根据扩展名设置内容类型
        ext = os.path.splitext(file_path)[1].lower()
        content_types = {
            '.html': 'text/html; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ogg': 'audio/ogg',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.css': 'text/css; charset=utf-8',
            '.ico': 'image/x-icon',
            '.wasm': 'application/wasm',
            '.txt': 'text/plain; charset=utf-8',
        }
        content_type = content_types.get(ext, 'application/octet-stream')

        try:
            with open(file_path, 'rb') as f:
                content = f.read()

            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            self.end_headers()
            self.wfile.write(content)

        except FileNotFoundError:
            self.send_error(404, f"File not found: {relative_path}")
        except IsADirectoryError:
            self.send_error(403, f"Is a directory: {relative_path}")
        except Exception as e:
            self.send_error(500, f"Server error: {str(e)}")

    def log_message(self, format, *args):
        pass


def run_server(port=8080):
    server_address = ('', port)
    httpd = HTTPServer(server_address, RequestHandler)
    print(f"服务根目录：{BASE_DIR}")
    print(f"服务器已启动，访问地址：http://localhost:{port}")
    print(f"手机访问：http://[电脑IP地址]:{port}")
    print("按 Ctrl+C 停止服务器")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止")


if __name__ == '__main__':
    run_server()