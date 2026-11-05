import functools
import http.server
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"


port, root = int(sys.argv[1]), sys.argv[2]
http.server.test(HandlerClass=functools.partial(Handler, directory=root), port=port, bind="127.0.0.1", protocol="HTTP/1.1")
