import urllib.request
try:
    req = urllib.request.Request('http://127.0.0.1:8000/api/nano-banana-pro', method='OPTIONS', headers={'Origin': 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type, x-provider'})
    res = urllib.request.urlopen(req)
    print(res.read())
    print(res.headers)
except Exception as e:
    print(f"Error: {e}")
    if hasattr(e, 'headers'):
        print(f"Headers: {e.headers}")
