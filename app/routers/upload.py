import logging

import cloudinary
import cloudinary.uploader
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from app.auth import get_current_user
from app.models.user import User
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/upload", tags=["upload"])

# Max upload size: 10 MB. Reject before sending to Cloudinary.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

cloudinary.config(
    cloud_name=settings.cloudinary_cloud_name,
    api_key=settings.cloudinary_api_key,
    api_secret=settings.cloudinary_api_secret
)

@router.post("/recipe-photo")
def upload_recipe_photo(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    if file.content_type not in ["image/jpeg", "image/png", "image/webp"]:
        raise HTTPException(
            status_code=400,
            detail="Only JPEG, PNG, and WebP images are supported"
        )

    if file.size is not None and file.size > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Image is too large (max 10 MB)"
        )

    try:
        result = cloudinary.uploader.upload(
            file.file,
            folder="issei/recipes",
            transformation=[
                {"width": 800, "height": 600, "crop": "fill"},
                {"quality": "auto"}
            ]
        )
        return {"url": result["secure_url"]}
    except Exception:
        logger.exception("Cloudinary upload failed for user %s", current_user.id)
        raise HTTPException(status_code=502, detail="Image upload failed. Please try again.")
