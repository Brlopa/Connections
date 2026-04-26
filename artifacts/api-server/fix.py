with open("src/routes/transport.ts", "r") as f:
    c = f.read()

c = c.replace("\\`", "`")
c = c.replace("\\${", "${")
c = c.replace("\\\\", "\\")

with open("src/routes/transport.ts", "w") as f:
    f.write(c)
