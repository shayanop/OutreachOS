CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY,
    company TEXT NOT NULL,
    industry TEXT NOT NULL,
    city TEXT NOT NULL,
    employees INT CHECK (employees >= 0),
    website TEXT,
    contact_name TEXT,
    contact_title TEXT,
    contact_email TEXT CHECK (
        contact_email ~* '^[^@[:space:]]+@([a-z0-9-]+[.])*example[.]com$'
    ),
    notes TEXT
);

CREATE TABLE IF NOT EXISTS pipeline (
    user_id TEXT NOT NULL,
    lead_id INT NOT NULL REFERENCES leads(id),
    stage TEXT NOT NULL CHECK (stage IN ('new','contacted','replied','meeting','won','lost')),
    note TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, lead_id)
);

CREATE TABLE IF NOT EXISTS drafts (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    lead_id INT NOT NULL REFERENCES leads(id),
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_send','sent')),
    pending_turn TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS memories (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    fact TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, fact)
);

CREATE TABLE IF NOT EXISTS chat_log (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    message TEXT NOT NULL,
    reply TEXT NOT NULL,
    tool_calls JSONB NOT NULL,
    tokens_in INT NOT NULL,
    tokens_out INT NOT NULL,
    ms INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drafts_user ON drafts(user_id);
CREATE INDEX IF NOT EXISTS memories_user ON memories(user_id, id DESC);
