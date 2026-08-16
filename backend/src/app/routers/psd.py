from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import Response

from ..services.psd_service import (
    export_psd_to_zip,
    PSDValidationError,
    PSDServiceError
)

# Note: We need to ensure we only catch PSDValidationError, PSDServiceError
# as PSDNotFoundError doesn't exist yet but if we added it, we'd import it.

router = APIRouter(prefix="/psd", tags=["psd"])

@router.post("/save")
async def save_psd(
    file: UploadFile = File(...),
    state: str = Form(...)
):
    try:
        file_content = await file.read()
        filename = file.filename or "export.zip"
        
        zip_bytes = export_psd_to_zip(file_content, state, filename)
        
        return Response(
            content=zip_bytes, 
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
        
    except PSDValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PSDServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
