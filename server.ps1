$port = 8080
$root = $PSScriptRoot

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$port/")
$listener.Start()
Write-Host "服务器已启动: http://localhost:$port"
Write-Host "根目录: $root"
Write-Host "按 Ctrl+C 停止"

# 完整的 MIME 类型表（含字体、音视频、模型等）
function Get-MimeType([string]$ext) {
    switch ($ext) {
        ".html" { "text/html; charset=utf-8" }
        ".htm"  { "text/html; charset=utf-8" }
        ".js"   { "application/javascript; charset=utf-8" }
        ".mjs"  { "application/javascript; charset=utf-8" }
        ".css"  { "text/css; charset=utf-8" }
        ".json" { "application/json; charset=utf-8" }
        ".map"  { "application/json; charset=utf-8" }
        ".xml"  { "application/xml; charset=utf-8" }
        ".txt"  { "text/plain; charset=utf-8" }
        ".csv"  { "text/csv; charset=utf-8" }
        ".md"   { "text/markdown; charset=utf-8" }

        # 图片
        ".png"  { "image/png" }
        ".jpg"  { "image/jpeg" }
        ".jpeg" { "image/jpeg" }
        ".gif"  { "image/gif" }
        ".svg"  { "image/svg+xml" }
        ".webp" { "image/webp" }
        ".ico"  { "image/x-icon" }
        ".bmp"  { "image/bmp" }
        ".avif" { "image/avif" }

        # 字体（关键！之前缺失的）
        ".woff"  { "font/woff" }
        ".woff2" { "font/woff2" }
        ".ttf"   { "font/ttf" }
        ".otf"   { "font/otf" }
        ".eot"   { "application/vnd.ms-fontobject" }

        # 音视频
        ".mp3"  { "audio/mpeg" }
        ".wav"  { "audio/wav" }
        ".ogg"  { "audio/ogg" }
        ".oga"  { "audio/ogg" }
        ".m4a"  { "audio/mp4" }
        ".aac"  { "audio/aac" }
        ".flac" { "audio/flac" }
        ".mp4"  { "video/mp4" }
        ".webm" { "video/webm" }
        ".ogv"  { "video/ogg" }
        ".mov"  { "video/quicktime" }
        ".m3u8" { "application/vnd.apple.mpegurl" }
        ".ts"   { "video/mp2t" }

        # WebAssembly / 模型 / 二进制
        ".wasm"  { "application/wasm" }
        ".glb"   { "model/gltf-binary" }
        ".gltf"  { "model/gltf+json" }
        ".obj"   { "model/obj" }
        ".fbx"   { "application/octet-stream" }
        ".stl"   { "model/stl" }
        ".zip"   { "application/zip" }
        ".pdf"   { "application/pdf" }

        default  { "application/octet-stream" }
    }
}

while ($listener.IsListening) {
    try {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response

        # 只处理 GET / HEAD
        if ($req.HttpMethod -ne "GET" -and $req.HttpMethod -ne "HEAD") {
            $res.StatusCode = 405
            $res.Close()
            continue
        }

        $path = [System.Uri]::UnescapeDataString($req.Url.LocalPath).TrimStart('/')
        if ([string]::IsNullOrEmpty($path)) { $path = "index.html" }

        # 拼路径并规范化，防止目录穿越
        $fullRoot = (Resolve-Path $root).Path.TrimEnd('\') + '\'
        $file = Join-Path $root $path
        try {
            $fullFile = [System.IO.Path]::GetFullPath($file)
        } catch {
            $res.StatusCode = 400
            $res.Close()
            continue
        }

        if (-not $fullFile.StartsWith($fullRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            $res.StatusCode = 403
            $res.Close()
            continue
        }

        if (Test-Path -LiteralPath $fullFile -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($fullFile)
            $ext = [System.IO.Path]::GetExtension($fullFile).ToLower()
            $res.ContentType = Get-MimeType $ext
            $res.ContentLength64 = $bytes.Length
            $res.Headers.Add("Cache-Control", "no-cache, no-store, must-revalidate")
            $res.Headers.Add("Access-Control-Allow-Origin", "*")

            if ($req.HttpMethod -eq "GET") {
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        } else {
            $res.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
            $res.ContentType = "text/plain; charset=utf-8"
            $res.ContentLength64 = $msg.Length
            $res.OutputStream.Write($msg, 0, $msg.Length)
        }
        $res.Close()
    } catch {
        Write-Host "请求处理错误: $_"
        try { $ctx.Response.StatusCode = 500; $ctx.Response.Close() } catch {}
    }
}