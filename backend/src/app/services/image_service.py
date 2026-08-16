import io
from PIL import Image
from rembg import remove, new_session

def remove_background(
    image_bytes: bytes,
    alpha_matting: bool = False,
    alpha_matting_foreground_threshold: int = 240,
    alpha_matting_background_threshold: int = 10,
    alpha_matting_erode_size: int = 10
) -> bytes:
    """
    Remove the background from an image using rembg with isnet-anime model.
    
    Args:
        image_bytes: The raw bytes of the input image.
        
    Returns:
        The raw bytes of the output PNG image with the background removed.
    """
    input_image = Image.open(io.BytesIO(image_bytes))
    session = new_session("isnet-anime")
    output_image = remove(
        input_image,
        session=session,
        alpha_matting=alpha_matting,
        alpha_matting_foreground_threshold=alpha_matting_foreground_threshold,
        alpha_matting_background_threshold=alpha_matting_background_threshold,
        alpha_matting_erode_size=alpha_matting_erode_size
    )
    
    out_io = io.BytesIO()
    output_image.save(out_io, format="PNG")
    return out_io.getvalue()
