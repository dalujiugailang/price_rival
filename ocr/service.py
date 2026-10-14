import base64, io, json, threading, time, multiprocessing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from PIL import Image
Image.MAX_IMAGE_PIXELS = 12_000_000
lock = threading.Lock()
def infer(raw, channel):
    try:
        import resource
        import numpy as np
        from rapidocr_onnxruntime import RapidOCR
        start=time.monotonic()
        engine=RapidOCR(intra_op_num_threads=1, inter_op_num_threads=1)
        img=Image.open(io.BytesIO(raw)).convert('RGB')
        result,_=engine(np.ascontiguousarray(np.asarray(img)[:,:,::-1]))
        lines=[{'box':np.asarray(box).tolist(),'text':text,'confidence':float(score)} for box,text,score in (result or [])]
        channel.send({'lines':lines,'durationMs':round((time.monotonic()-start)*1000),'peakMemoryMb':round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024)})
    except Exception: channel.send({'error':'OCR failed'})
    finally: channel.close()
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def reply(self, status, payload):
        data=json.dumps(payload,ensure_ascii=False).encode()
        self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def do_GET(self): self.reply(200 if self.path=='/health' else 404,{'ready':True})
    def do_POST(self):
        self.connection.settimeout(20)
        if self.path!='/recognize':return self.reply(404,{'error':'Not found'})
        try: length=int(self.headers.get('Content-Length','0'))
        except ValueError:return self.reply(400,{'error':'Invalid length'})
        if length<1 or length>14_000_000:return self.reply(413,{'error':'Image too large'})
        if not lock.acquire(False):return self.reply(429,{'error':'OCR busy'})
        process=None
        try:
            body=json.loads(self.rfile.read(length));raw=base64.b64decode(body['image'].split(',',1)[1],validate=True)
            if len(raw)>10*1024*1024:return self.reply(413,{'error':'Image too large'})
            img=Image.open(io.BytesIO(raw))
            if img.format not in ('PNG','JPEG','WEBP') or img.width*img.height>12_000_000:return self.reply(400,{'error':'Invalid image'})
            img.verify()
            context=multiprocessing.get_context('spawn');reader,writer=context.Pipe(False)
            process=context.Process(target=infer,args=(raw,writer),daemon=True);process.start();writer.close()
            if not reader.poll(18):return self.reply(504,{'error':'OCR timed out'})
            result=reader.recv();reader.close();self.reply(500 if 'error' in result else 200,result)
        except (ValueError,KeyError,OSError,Image.DecompressionBombError):self.reply(400,{'error':'Invalid image'})
        except Exception:self.reply(500,{'error':'OCR failed'})
        finally:
            if process:
                if process.is_alive():process.terminate()
                process.join(timeout=1)
                if process.is_alive():process.kill();process.join()
            lock.release()
if __name__=='__main__':ThreadingHTTPServer(('0.0.0.0',8080),Handler).serve_forever()
