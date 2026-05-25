import asyncio
from typing import AsyncGenerator
from langgraph.checkpoint.memory import MemorySaver
import inspect

async def main():
    checkpointer = MemorySaver()
    print("Has asearch:", hasattr(checkpointer, "asearch"))
    print("Has search:", hasattr(checkpointer, "search"))
    
    # Try inserting a fake state
    print(dir(checkpointer))
    print(vars(checkpointer))
    print(checkpointer.storage)

asyncio.run(main())
