import os, re
os.chdir(os.path.dirname(os.path.abspath(__file__)) or ".")
print("Script works!")
print(os.path.exists("index.html"))
