import requests
import json
import os

filepath = '../sample/test.psd'
filename = 'test.zip'
state = []

with open(filepath, 'rb') as f:
    files = {'file': (filename, f, 'application/octet-stream')}
    data = {'state': json.dumps(state)}
    response = requests.post('http://localhost:8000/api/psd/save', files=files, data=data)

if response.status_code == 200:
    print("Success. Content length:", len(response.content))
    with open('result.zip', 'wb') as f:
        f.write(response.content)
    import zipfile
    try:
        with zipfile.ZipFile('result.zip', 'r') as z:
            print("Zip contents:", z.namelist())
    except Exception as e:
        print("Invalid zip:", e)
else:
    print("Failed:", response.status_code, response.text)
