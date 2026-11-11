import sys, struct, io
from PIL import Image
out=sys.argv[1]; srcs=sys.argv[2:]
entries=[]
for p in srcs:
    im=Image.open(p).convert("RGBA"); w,h=im.size
    if w>=256:
        b=io.BytesIO(); im.save(b,"PNG"); data=b.getvalue(); bpp=32
    else:
        # 32bpp BI_RGB DIB, bottom-up BGRA, height doubled, plus 1bpp AND mask
        px=im.tobytes("raw","BGRA"); rows=[px[y*w*4:(y+1)*w*4] for y in range(h)]
        xor=b"".join(reversed(rows))
        mrow=((w+31)//32)*4; amask=bytearray()
        a=im.getchannel("A").tobytes()
        for y in reversed(range(h)):
            r=bytearray(mrow)
            for x in range(w):
                if a[y*w+x]==0: r[x//8]|=0x80>>(x%8)
            amask+=r
        hdr=struct.pack("<IiiHHIIiiII",40,w,h*2,1,32,0,len(xor)+len(amask),0,0,0,0)
        data=hdr+xor+bytes(amask); bpp=32
    entries.append((w,h,bpp,data))
entries.sort(key=lambda e:e[0])
off=6+16*len(entries); dirb=b""; body=b""
for w,h,bpp,data in entries:
    dirb+=struct.pack("<BBBBHHII",w%256,h%256,0,0,1,bpp,len(data),off+len(body)); body+=data
open(out,"wb").write(struct.pack("<HHH",0,1,len(entries))+dirb+body)
chk=Image.open(out); print("ico sizes:",sorted(chk.info.get("sizes",chk.ico.sizes())))
