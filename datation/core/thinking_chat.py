"""
Thinking Mode Compatibility Layer — Adapts to any OpenAI-compatible API supporting reasoning_content.

When thinking mode is enabled in the model API (e.g. DeepSeek), the `reasoning_content` field
is returned in the assistant message. Subsequent turns of conversation must send this field back,
otherwise the API throws an error.

LangChain's ChatOpenAI does not handle `reasoning_content`. This module inherits from ChatOpenAI
and overrides key methods to achieve saving and sending back reasoning_content, thereby supporting multi-turn agent conversations.
"""

from __future__ import annotations

from typing import Any

import openai
from langchain_core.language_models import LanguageModelInput
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGenerationChunk, ChatResult
from langchain_openai import ChatOpenAI


class ChatOpenAIThinking(ChatOpenAI):
    """ChatOpenAI with reasoning_content round-trip support.

    Compatible with any OpenAI-compatible API that returns `reasoning_content`
    in assistant messages when thinking/reasoning mode is enabled (e.g., DeepSeek,
    or any future provider following the same convention).

    What it does on top of ChatOpenAI:
    1. **Capture**: After receiving an API response, stores `reasoning_content`
       in `AIMessage.additional_kwargs["reasoning_content"]`.
    2. **Re-inject**: Before sending a request, injects `reasoning_content` back
       into assistant messages in the request payload.
    """

    def _create_chat_result(
        self,
        response: dict | openai.BaseModel,
        generation_info: dict | None = None,
    ) -> ChatResult:
        """Override to capture reasoning_content from API response."""
        rtn = super()._create_chat_result(response, generation_info)

        if not isinstance(response, openai.BaseModel):
            return rtn

        choices = getattr(response, "choices", None)
        if choices and hasattr(choices[0].message, "reasoning_content"):
            rc = choices[0].message.reasoning_content
            if rc is not None:
                rtn.generations[0].message.additional_kwargs["reasoning_content"] = rc

        return rtn

    def _convert_chunk_to_generation_chunk(
        self,
        chunk: dict,
        default_chunk_class: type,
        base_generation_info: dict | None,
    ) -> ChatGenerationChunk | None:
        """Override to capture reasoning_content from streaming chunks."""
        generation_chunk = super()._convert_chunk_to_generation_chunk(
            chunk, default_chunk_class, base_generation_info,
        )
        if (choices := chunk.get("choices")) and generation_chunk:
            top = choices[0]
            if isinstance(generation_chunk.message, AIMessageChunk):
                if (
                    rc := top.get("delta", {}).get("reasoning_content")
                ) is not None:
                    generation_chunk.message.additional_kwargs["reasoning_content"] = rc

        return generation_chunk

    def _get_request_payload(
        self,
        input_: LanguageModelInput,
        *,
        stop: list[str] | None = None,
        **kwargs: Any,
    ) -> dict:
        """Override to re-inject reasoning_content into assistant messages."""
        payload = super()._get_request_payload(input_, stop=stop, **kwargs)

        # Resolve original messages to access additional_kwargs
        from langchain_core.messages import BaseMessage
        if isinstance(input_, list) and input_ and isinstance(input_[0], BaseMessage):
            original_messages = input_
        elif isinstance(input_, str):
            original_messages = []
        else:
            try:
                original_messages = (
                    input_.to_messages() if hasattr(input_, "to_messages") else []
                )
            except Exception:
                original_messages = []

        # Collect reasoning_content from AIMessages in order
        ai_msg_reasoning: list[str | None] = []
        for msg in original_messages:
            if isinstance(msg, AIMessage):
                ai_msg_reasoning.append(
                    msg.additional_kwargs.get("reasoning_content")
                )

        # Inject reasoning_content back into payload's assistant messages
        ai_idx = 0
        for msg_dict in payload.get("messages", []):
            if msg_dict.get("role") == "assistant":
                if ai_idx < len(ai_msg_reasoning) and ai_msg_reasoning[ai_idx]:
                    msg_dict["reasoning_content"] = ai_msg_reasoning[ai_idx]
                ai_idx += 1

        return payload
