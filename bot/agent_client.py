"""Low-overhead agent configuration client for the voice bot.

Agent configuration is resolved at call setup and cached briefly. No remote
request is made from the audio/turn hot path.
"""

import asyncio
import time
from typing import Any, Optional

import httpx

from bot.config import settings


class AgentConfigClient:
    def __init__(self, client: httpx.AsyncClient):
        self.client = client
        self._cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._lock = asyncio.Lock()
        self.ttl_seconds = 30.0

    async def get(
        self,
        agent_id: str,
        tenant_id: str,
        version: Optional[int] = None,
    ) -> Optional[dict[str, Any]]:
        key = f"{tenant_id}:{agent_id}:{version or 'latest'}"
        cached = self._cache.get(key)
        if cached and cached[0] > time.monotonic():
            return cached[1]

        async with self._lock:
            cached = self._cache.get(key)
            if cached and cached[0] > time.monotonic():
                return cached[1]

            url = f"{settings.worker_base_url.rstrip('/')}/agents/{agent_id}"
            if version is not None:
                url += f"?version={version}"
            else:
                url += "?published=true"

            try:
                response = await self.client.get(
                    url,
                    headers={
                        "Authorization": f"Bearer {settings.ingest_token}",
                        "X-Tenant-ID": tenant_id,
                    },
                    timeout=2.0,
                )
                response.raise_for_status()
                payload = response.json()
                definition = payload["definition"]
                self._cache[key] = (time.monotonic() + self.ttl_seconds, definition)
                return definition
            except Exception:
                # Agent configuration is an enhancement to the existing voice
                # service. Falling back keeps the base demo operational.
                return None
