import os
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.responses import HTMLResponse

router = APIRouter()
security = HTTPBasic()

BASIC_AUTH_USERNAME = "issei"
BASIC_AUTH_PASSWORD = "recipes"

def verify_basic_auth(credentials: HTTPBasicCredentials = Depends(security)):
    if credentials.username != BASIC_AUTH_USERNAME or credentials.password != BASIC_AUTH_PASSWORD:
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"}
        )
    return credentials

@router.get("/mom-form", response_class=HTMLResponse)
def get_mom_form(credentials: HTTPBasicCredentials = Depends(verify_basic_auth)):
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    file_path = os.path.join(base_dir, "static", "mom_form.html")
    with open(file_path) as f:
        return f.read()
