import sys
import zipfile
from io import BytesIO
from psd_tools import PSDImage

try:
    psd = PSDImage.open('../sample/test.psd')
    output_buffer = BytesIO()
    with zipfile.ZipFile(output_buffer, 'w', zipfile.ZIP_DEFLATED) as zipf:
        def process_layers(layers, path=""):
            for i, layer in enumerate(layers):
                if layer.is_group():
                    print(f"Group: {path}{layer.name}/")
                    process_layers(layer, f"{path}{layer.name}/")
                else:
                    visible = layer.is_visible()
                    w = getattr(layer, 'width', 0)
                    h = getattr(layer, 'height', 0)
                    print(f"Layer: {path}{layer.name} - visible: {visible}, w: {w}, h: {h}")
                    if visible and w > 0 and h > 0:
                        try:
                            img = layer.topil()
                            if img:
                                img_io = BytesIO()
                                img.save(img_io, format='PNG')
                                safe_name = "".join([c if c.isalnum() or c in " _-" else "_" for c in layer.name])
                                zipf.writestr(f"{path}{i:03d}_{safe_name}.png", img_io.getvalue())
                                print(f"  Success {safe_name}")
                            else:
                                print(f"  None img {layer.name}")
                        except Exception as e:
                            print(f"  Error topil {layer.name}: {e}")
        
        process_layers(psd)
    output_buffer.seek(0)
    print(f"Zip size: {len(output_buffer.getvalue())}")
except Exception as e:
    print("Error:", e)
