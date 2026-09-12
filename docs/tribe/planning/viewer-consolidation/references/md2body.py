import sys,re,markdown,html
src=open(sys.argv[1]).read()
# 1. mermaid fences -> design-system figures
src=re.sub(r"```mermaid\n(.*?)```", lambda m: '\n<figure class="diagram">\n<div class="mermaid">'+html.escape(m.group(1))+'</div>\n</figure>\n', src, flags=re.S)
# 2. dedent fenced code blocks that sit inside list items so python-markdown renders them
out=[]; infence=False; indent=""
for line in src.split("\n"):
    m=re.match(r"^(\s*)```", line)
    if m and not infence:
        infence=True; indent=m.group(1); out.append(line[len(indent):]); continue
    if m and infence:
        infence=False; out.append(line[len(indent):] if line.startswith(indent) else line.lstrip()); indent=""; continue
    if infence:
        out.append(line[len(indent):] if line.startswith(indent) else line); continue
    out.append(line)
src="\n".join(out)
# 3. strikethrough
src=re.sub(r"~~(.+?)~~", r"<del>\1</del>", src)
body=markdown.markdown(src, extensions=['tables','fenced_code','toc'], output_format='html5')
open(sys.argv[2],'w').write(body)
print("body bytes", len(body))
