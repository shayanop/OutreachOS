"""LangGraph agent: guard -> agent <-> tools."""
import os
from uuid import uuid4

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

import db
import guard
from prompts import SYSTEM_PROMPT
from tools import TOOLS

KEEP_USER_TURNS = 6  # short-term window sent to the model (full history stays in the checkpointer)

llm = ChatAnthropic(
    model=os.environ.get("MODEL", "claude-haiku-5-5"),
    max_tokens=700,
    timeout=30,
    max_retries=2,
    thinking={"type": "disabled"},
    effort="low",
).bind_tools(TOOLS)


def _last_human(messages) -> int:
    return max(i for i, m in enumerate(messages) if isinstance(m, HumanMessage))


def guard_node(state: MessagesState):
    refusal = guard.check(state["messages"][-1].content)
    return {"messages": [AIMessage(refusal)]} if refusal else {}


def route_guard(state: MessagesState):
    return END if isinstance(state["messages"][-1], AIMessage) else "agent"


def agent_node(state: MessagesState, config: RunnableConfig):
    msgs = state["messages"]
    humans = [i for i, m in enumerate(msgs) if isinstance(m, HumanMessage)]
    window = msgs[humans[-KEEP_USER_TURNS]:] if len(humans) > KEEP_USER_TURNS else msgs
    facts = db.get_memories(config["configurable"]["user_id"])
    system = SYSTEM_PROMPT + "\n\nKnown about this user:\n" + ("\n".join(f"- {f}" for f in facts) or "- nothing yet")
    return {"messages": [llm.invoke([SystemMessage(system), *window])]}


builder = StateGraph(MessagesState)
builder.add_node("guard", guard_node)
builder.add_node("agent", agent_node)
builder.add_node("tools", ToolNode(TOOLS))
builder.add_edge(START, "guard")
builder.add_conditional_edges("guard", route_guard, ["agent", END])
builder.add_conditional_edges("agent", tools_condition, ["tools", END])
builder.add_edge("tools", "agent")
graph = builder.compile(checkpointer=db.checkpointer())


def _text(msg: AIMessage) -> str:
    if isinstance(msg.content, str):
        return msg.content
    return "".join(b.get("text", "") for b in msg.content if isinstance(b, dict) and b.get("type") == "text")


def run_turn(user_id: str, thread_id: str, message: str) -> dict:
    config = {
        "configurable": {"thread_id": f"{user_id}:{thread_id}", "user_id": user_id, "turn_id": uuid4().hex},
        "recursion_limit": 12,
    }
    # durability="exit": one checkpoint write per turn instead of one per step (fewer DB round trips)
    out = graph.invoke({"messages": [HumanMessage(message)]}, config, durability="exit")
    turn = out["messages"][_last_human(out["messages"]) + 1:]
    ais = [m for m in turn if isinstance(m, AIMessage)]
    return {
        "reply": next((_text(m) for m in reversed(ais) if _text(m).strip()), ""),
        "tool_calls": [{"name": tc["name"], "args": tc["args"]} for m in ais for tc in m.tool_calls],
        "tokens": {
            "in": sum((m.usage_metadata or {}).get("input_tokens", 0) for m in ais),
            "out": sum((m.usage_metadata or {}).get("output_tokens", 0) for m in ais),
        },
    }
