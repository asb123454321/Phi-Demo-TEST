#!/usr/bin/env python3
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, unquote

class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        # 解析路径
        parsed_path = urlparse(self.path)
        path = unquote(parsed_path.path)
        
        # 默认页面
        if path == "/" or path == "/storage/emulated/0/WebCatX/project/Phigros模拟器/index.html":
            path = "/storage/emulated/0/WebCatX/project/Phigros模拟器/index.html"
            file_path = "index.html"
            content_type = "text/html; charset=utf-8"
        else:
            file_path = path[1:]  # 去掉开头的 /
            
            # 根据扩展名设置内容类型
            ext = os.path.splitext(file_path)[1].lower()
            content_types = {
                '.html': 'text/html; charset=utf-8',
                '.js': 'application/javascript; charset=utf-8',
                '.json': 'application/json; charset=utf-8',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.ogg': 'audio/ogg',
                '.mp3': 'audio/mpeg',
                '.css': 'text/css; charset=utf-8',
                '.ico': 'image/x-icon',
            }
            content_type = content_types.get(ext, 'application/octet-stream')
        
        try:
            # 读取文件
            with open(file_path, 'rb') as f:
                content = f.read()
            
            # 发送响应
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            self.end_headers()
            
            # 发送内容
            self.wfile.write(content)
            
        except FileNotFoundError:
            self.send_error(404, f"File not found: {file_path}")
        except Exception as e:
            self.send_error(500, f"Server error: {str(e)}")
    
    def log_message(self, format, *args):
        # 减少日志输出
        pass

def run_server(port=8080):
    server_address = ('', port)
    httpd = HTTPServer(server_address, RequestHandler)
    print(f"服务器已启动，访问地址：http://localhost:{port}")
    print(f"手机访问：http://[电脑IP地址]:{port}")
    print("按 Ctrl+C 停止服务器")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止")

if __name__ == '__main__':
    run_server()