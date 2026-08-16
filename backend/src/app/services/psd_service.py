import json
import zipfile
from io import BytesIO
from psd_tools import PSDImage

class PSDServiceError(Exception):
    pass

class PSDValidationError(PSDServiceError):
    pass

def export_psd_to_zip(file_content: bytes, state_json: str, filename: str) -> bytes:
    try:
        psd = PSDImage.open(BytesIO(file_content))
        layer_states = json.loads(state_json)
        state_map = {item["id"]: item for item in layer_states}
        
        # Function to recursively apply state
        def apply_state(layer):
            if hasattr(layer, "layer_id") and layer.layer_id in state_map:
                update = state_map[layer.layer_id]
                if "visible" in update:
                    layer.visible = update["visible"]
                if "opacity" in update:
                    layer.opacity = int(update["opacity"])
            
            if hasattr(layer, "__iter__"):
                for child in layer:
                    apply_state(child)

        for layer in psd:
            apply_state(layer)
            
        if not filename.lower().endswith('.zip'):
            raise PSDValidationError("Backend only supports .zip export. Use frontend for .psd saving.")
            
        output_buffer = BytesIO()
        with zipfile.ZipFile(output_buffer, 'w', zipfile.ZIP_DEFLATED) as zipf:
            def process_layers(layers, path=""):
                used_names = set()
                for i, layer in enumerate(layers):
                    clean_name = layer.name.replace('\x00', '')
                    safe_name = "".join([c if c.isalnum() or c in " _-." else "_" for c in clean_name]).strip()
                    if not safe_name:
                        safe_name = f"layer_{i}"
                        
                    base_name = safe_name
                    counter = 1
                    while safe_name in used_names:
                        safe_name = f"{base_name}_{counter}"
                        counter += 1
                    used_names.add(safe_name)

                    if layer.is_group():
                        process_layers(layer, f"{path}{safe_name}/")
                    else:
                        is_vis = layer.is_visible()
                        w = getattr(layer, 'width', 0)
                        h = getattr(layer, 'height', 0)
                        if is_vis and w > 0 and h > 0:
                            try:
                                img = layer.topil()
                                if img:
                                    img_io = BytesIO()
                                    img.save(img_io, format='PNG')
                                    zipf.writestr(f"{path}{safe_name}.png", img_io.getvalue())
                            except Exception as e:
                                print(f"Error exporting layer {layer.name}: {e}")
            
            process_layers(psd)
            
        output_buffer.seek(0)
        return output_buffer.getvalue()
        
    except PSDValidationError:
        raise
    except json.JSONDecodeError as e:
        raise PSDValidationError(f"Invalid state JSON: {str(e)}")
    except Exception as e:
        raise PSDServiceError(f"Failed to process PSD: {str(e)}")
