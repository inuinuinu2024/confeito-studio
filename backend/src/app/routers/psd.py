from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
import json
from io import BytesIO
from psd_tools import PSDImage

router = APIRouter(prefix="/psd", tags=["psd"])

@router.post("/save")
async def save_psd(
    file: UploadFile = File(...),
    state: str = Form(...)
):
    try:
        # Load the PSD file content
        file_content = await file.read()
        psd = PSDImage.open(BytesIO(file_content))
        
        # Parse the layer states
        # Expected format: list of dicts {"id": int, "visible": bool, "opacity": float (0-255)}
        layer_states = json.loads(state)
        state_map = {item["id"]: item for item in layer_states}
        
        # Function to recursively apply state
        def apply_state(layer):
            if hasattr(layer, "layer_id") and layer.layer_id in state_map:
                update = state_map[layer.layer_id]
                if "visible" in update:
                    layer.visible = update["visible"]
                if "opacity" in update:
                    # ag-psd uses 0-255, psd_tools uses 0-255
                    layer.opacity = int(update["opacity"])
            
            # If layer has children, recurse
            if hasattr(layer, "__iter__"):
                for child in layer:
                    apply_state(child)

        # Apply state changes to all layers in the PSD
        for layer in psd:
            apply_state(layer)
            
        filename = file.filename or "export.zip"
        
        if not filename.lower().endswith('.zip'):
            raise HTTPException(status_code=400, detail="Backend only supports .zip export. Use frontend for .psd saving.")
            import zipfile
            
            output_buffer = BytesIO()
            print("Creating Zip file...")
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
            media_type = "application/zip"
            
        from fastapi.responses import Response
        
        return Response(
            content=output_buffer.getvalue(), 
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
