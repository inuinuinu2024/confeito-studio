import io
from PIL import Image
from rembg import remove

def remove_background(image_bytes: bytes) -> bytes:
    """
    Remove the background from an image using rembg.
    
    Args:
        image_bytes: The raw bytes of the input image.
        
    Returns:
        The raw bytes of the output PNG image with the background removed.
    """
    input_image = Image.open(io.BytesIO(image_bytes))
    output_image = remove(input_image)
    
    out_io = io.BytesIO()
    output_image.save(out_io, format="PNG")
    return out_io.getvalue()
