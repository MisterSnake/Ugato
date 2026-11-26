from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.games import ws

app = FastAPI(title="backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(ws.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
