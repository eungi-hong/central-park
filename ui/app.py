import os
from datetime import datetime, timezone

import requests
import streamlit as st

AGENT_BASE = os.environ.get("CP_AGENT_BASE_URL", "http://localhost:8001")
FHIR_BASE = os.environ.get("CP_FHIR_BASE_URL", "http://localhost:52773/csp/healthshare/centralpark/fhir/r4")
FHIR_USER = os.environ.get("CP_FHIR_USER", "_SYSTEM")
FHIR_PASS = os.environ.get("CP_FHIR_PASSWORD", "SYS")

QUESTIONS = [
    {"link_id": "chief-complaint",     "text": "What's your main concern today? Please describe what's been happening."},
    {"link_id": "onset",               "text": "When did this start, and has it been getting better, worse, or staying the same?"},
    {"link_id": "severity",            "text": "On a scale of 1 to 10, how would you rate the severity right now?"},
    {"link_id": "associated-symptoms", "text": "Are you experiencing any of the following: shortness of breath, chest tightness, fever, nausea, dizziness, or weakness on one side?"},
    {"link_id": "history",             "text": "Do you have any history of similar symptoms, or any recent illness, injury, or surgery?"},
    {"link_id": "self-treatment",      "text": "Have you tried anything to manage this so far — any medications or home remedies?"},
]

LEVEL_CONFIG = {
    "self-care":   {"color": "#2e7d32", "label": "Self-care"},
    "see-gp":      {"color": "#f9a825", "label": "See GP"},
    "urgent-care": {"color": "#e65100", "label": "Urgent care"},
    "ed":          {"color": "#b71c1c", "label": "Go to ED"},
}


def _init_state():
    defaults = {
        "phase": "setup",
        "patient_id": "demo-patient-1",
        "messages": [],
        "qa": [],
        "current_q": 0,
        "qr_id": None,
        "handoff": None,
    }
    for k, v in defaults.items():
        if k not in st.session_state:
            st.session_state[k] = v


def _start_interview():
    st.session_state.phase = "interview"
    st.session_state.messages = [
        {
            "role": "assistant",
            "content": (
                "Hello. I'm going to ask you a few short questions so the clinical "
                "team has everything they need.\n\n"
                f"**{QUESTIONS[0]['text']}**"
            ),
        }
    ]
    st.session_state.qa = []
    st.session_state.current_q = 0
    st.session_state.qr_id = None
    st.session_state.handoff = None


def _handle_answer(answer: str):
    q = QUESTIONS[st.session_state.current_q]
    st.session_state.qa.append({
        "link_id": q["link_id"],
        "question": q["text"],
        "answer": answer,
    })
    st.session_state.messages.append({"role": "user", "content": answer})

    next_idx = st.session_state.current_q + 1
    if next_idx < len(QUESTIONS):
        st.session_state.current_q = next_idx
        st.session_state.messages.append(
            {"role": "assistant", "content": f"**{QUESTIONS[next_idx]['text']}**"}
        )
    else:
        st.session_state.messages.append(
            {"role": "assistant", "content": "Thank you — saving your responses and preparing the clinical handoff summary now…"}
        )
        st.session_state.phase = "processing"


def _post_qr() -> str:
    """POST a QuestionnaireResponse to FHIR and return the server-assigned id."""
    authored = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = {
        "resourceType": "QuestionnaireResponse",
        "questionnaire": "Questionnaire/triage-intake",
        "status": "completed",
        "subject": {"reference": f"Patient/{st.session_state.patient_id}"},
        "authored": authored,
        "item": [
            {
                "linkId": item["link_id"],
                "text": item["question"],
                "answer": [{"valueString": item["answer"]}],
            }
            for item in st.session_state.qa
        ],
    }
    resp = requests.post(
        f"{FHIR_BASE}/QuestionnaireResponse",
        json=payload,
        auth=(FHIR_USER, FHIR_PASS),
        headers={"Content-Type": "application/fhir+json", "Accept": "application/fhir+json"},
        timeout=30,
    )
    resp.raise_for_status()
    new_id = ""
    if resp.content:
        try:
            new_id = resp.json().get("id", "")
        except ValueError:
            pass
    if not new_id:
        location = resp.headers.get("Location") or resp.headers.get("Content-Location") or ""
        parts = [p for p in location.split("/") if p]
        if "QuestionnaireResponse" in parts:
            idx = parts.index("QuestionnaireResponse")
            if idx + 1 < len(parts):
                new_id = parts[idx + 1]
    return new_id


def _call_backend(qr_id: str) -> dict:
    resp = requests.post(
        f"{AGENT_BASE}/interview",
        json={
            "patient_id": st.session_state.patient_id,
            "questionnaire_response_id": qr_id,
        },
        timeout=90,
    )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------

st.set_page_config(page_title="Central Park", page_icon="🏥", layout="centered")
st.title("Central Park")
st.caption("Structured triage interview · clinician handoff")

_init_state()

# Setup screen
if st.session_state.phase == "setup":
    col1, col2 = st.columns([3, 1])
    with col1:
        pid_input = st.text_input("Patient ID", value=st.session_state.patient_id, label_visibility="collapsed")
    with col2:
        if st.button("Start", use_container_width=True):
            st.session_state.patient_id = pid_input
            _start_interview()
            st.rerun()

# Render chat history
if st.session_state.phase in ("interview", "processing", "complete"):
    for msg in st.session_state.messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])

# Processing — POST QR to FHIR, then call agent
if st.session_state.phase == "processing":
    with st.spinner("Saving interview to FHIR…"):
        try:
            qr_id = _post_qr()
            st.session_state.qr_id = qr_id
        except requests.exceptions.ConnectionError:
            st.error(f"Cannot reach FHIR at `{FHIR_BASE}`. Is IRIS running?")
            st.stop()
        except requests.exceptions.HTTPError as exc:
            st.error(f"FHIR returned {exc.response.status_code}: {exc.response.text[:300]}")
            st.stop()

    with st.spinner("Running triage…"):
        try:
            result = _call_backend(st.session_state.qr_id)
            st.session_state.handoff = result
            st.session_state.phase = "complete"
        except requests.exceptions.ConnectionError:
            st.error(f"Cannot reach agent at `{AGENT_BASE}`. Is the agent running?")
            st.stop()
        except requests.exceptions.HTTPError as exc:
            st.error(f"Agent returned {exc.response.status_code}: {exc.response.text[:300]}")
            st.stop()

    st.rerun()

# Handoff summary
if st.session_state.phase == "complete" and st.session_state.handoff:
    h = st.session_state.handoff
    level = (h.get("triage_level") or "see-gp").lower()
    cfg = LEVEL_CONFIG.get(level, {"color": "#555", "label": level.title()})

    st.divider()
    st.subheader("Clinician Handoff Summary")

    st.markdown(
        f"""<div style="
            background:{cfg['color']}22;
            border-left:6px solid {cfg['color']};
            padding:12px 16px;
            border-radius:6px;
            margin-bottom:16px;
        "><span style="color:{cfg['color']};font-size:1.25rem;font-weight:700;">{cfg['label']}</span></div>""",
        unsafe_allow_html=True,
    )

    if h.get("chief_complaint"):
        st.markdown(f"**Chief complaint:** {h['chief_complaint']}")

    if h.get("hpi"):
        st.markdown("**History of present illness**")
        st.markdown(h["hpi"])

    red_flags = h.get("red_flags") or []
    if red_flags:
        st.warning("**Red flags detected:** " + " · ".join(red_flags))

    actions = h.get("recommended_actions") or []
    if actions:
        st.markdown("**Recommended actions**")
        for a in actions:
            st.markdown(f"- {a}")

    citations = h.get("citations") or []
    if citations:
        st.divider()
        st.subheader("Guidelines cited")
        for c in citations:
            title = c.get("source") or c.get("slug") or "Guideline"
            with st.expander(title):
                st.write(c.get("snippet") or "_No excerpt available._")

    fhir_ids = []
    if st.session_state.qr_id:
        fhir_ids.append(f"QuestionnaireResponse `{st.session_state.qr_id}`")
    if h.get("encounter_id"):
        fhir_ids.append(f"Encounter `{h['encounter_id']}`")
    if h.get("service_request_id"):
        fhir_ids.append(f"ServiceRequest `{h['service_request_id']}`")
    obs = h.get("observation_ids") or []
    if obs:
        fhir_ids.append(f"{len(obs)} Observation{'s' if len(obs) != 1 else ''}")
    if fhir_ids:
        st.divider()
        st.caption("FHIR resources created · " + " · ".join(fhir_ids))

    st.divider()
    if st.button("New assessment", use_container_width=True):
        for k in ("phase", "messages", "qa", "current_q", "qr_id", "handoff"):
            if k in st.session_state:
                del st.session_state[k]
        st.rerun()

# Chat input — only during active interview
if st.session_state.phase == "interview":
    user_input = st.chat_input("Your answer…")
    if user_input:
        _handle_answer(user_input)
        st.rerun()
