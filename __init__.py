from .nodes.registry import NODE_CLASS_MAPPINGS
from . import server_routes as _server_routes  # noqa: F401

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "WEB_DIRECTORY"]
