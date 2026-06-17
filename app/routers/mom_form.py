from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.responses import HTMLResponse

router = APIRouter()
security = HTTPBasic()

def verify_basic_auth(credentials: HTTPBasicCredentials = Depends(security)):
    if credentials.username != "mama" or credentials.password != "test":
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return credentials

@router.get("/mom-form", response_class=HTMLResponse, dependencies=[Depends(verify_basic_auth)])
def get_mom_form():
    with open("app/static/mom_form.html") as f:
        return f.read()
