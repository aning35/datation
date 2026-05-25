from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI
import httpx
import json

# Intercept the HTTP request to OpenAI to see EXACTLY what is sent
original_send = httpx.Client.send

def apply_intercept():
    def intercepted_send(self, request, *args, **kwargs):
        if "openai" in str(request.url) or "chat/completions" in str(request.url):
            body = request.read().decode("utf-8")
            print("========================================")
            print("===        EXACT HTTP PAYLOAD        ===")
            print("======== SENT TO OpenAI ENDPOINT =======")
            print(json.dumps(json.loads(body), indent=2, ensure_ascii=False))
            print("========================================")
            # Throw exception here because we don't really want to hit the fake key
            raise ValueError("Intercepted! Stopping execution.")
        return original_send(self, request, *args, **kwargs)
    httpx.Client.send = intercepted_send

apply_intercept()

@tool
def my_custom_tool(x: int) -> int:
    """This is a test tool description that we are looking for."""
    return x * 2

llm = ChatOpenAI(api_key="fake-key", model="gpt-3.5-turbo", max_retries=0)
agent = create_react_agent(llm, tools=[my_custom_tool], prompt="This is the system prompt. Are tools appended here?")

print("Started agent logic...")
try:
    agent.invoke({"messages": [("user", "What is my_custom_tool(5)?")]})
except ValueError as e:
    print(f"Test Finished: {e}")
except Exception as getattr:
    import traceback
    traceback.print_exc()

