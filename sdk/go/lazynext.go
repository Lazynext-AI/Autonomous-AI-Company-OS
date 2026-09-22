// Package lazynext is a client for the Lazynext API — control the
// autonomous AI company from Go.
package lazynext

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

const DefaultBase = "https://ai-company.lazynext.com"

// Client talks to the Lazynext public API.
type Client struct {
	APIKey  string
	BaseURL string
	HTTP    *http.Client
}

func New(apiKey string) *Client {
	return &Client{APIKey: apiKey, BaseURL: DefaultBase, HTTP: &http.Client{Timeout: 30 * time.Second}}
}

func (c *Client) get(path string, params url.Values, out any) error {
	u, _ := url.Parse(c.BaseURL + path)
	u.RawQuery = params.Encode()
	req, _ := http.NewRequest("GET", u.String(), nil)
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	r, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer r.Body.Close()
	if r.StatusCode >= 400 {
		b, _ := io.ReadAll(r.Body)
		return fmt.Errorf("lazynext %d: %s", r.StatusCode, string(b))
	}
	return json.NewDecoder(r.Body).Decode(out)
}

func (c *Client) post(path string, body any, out any) error {
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", c.BaseURL+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	r, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer r.Body.Close()
	if r.StatusCode >= 400 {
		errBody, _ := io.ReadAll(r.Body)
		return fmt.Errorf("lazynext %d: %s", r.StatusCode, string(errBody))
	}
	return json.NewDecoder(r.Body).Decode(out)
}

func (c *Client) Status() (map[string]any, error) {
	var out map[string]any
	return out, c.get("/api/v1/status", nil, &out)
}

func (c *Client) JoinWaitlist(email string) error {
	return c.post("/api/v1/waitlist", map[string]string{"email": email}, nil)
}

func (c *Client) ListBriefings(limit int) (map[string]any, error) {
	var out map[string]any
	return out, c.get("/api/v1/briefings", url.Values{"limit": {fmt.Sprint(limit)}}, &out)
}

func (c *Client) CreateTask(desc, channel string, priority int) (map[string]any, error) {
	var out map[string]any
	return out, c.post("/api/v1/tasks",
		map[string]any{"description": desc, "channel": channel, "priority": priority}, &out)
}

func (c *Client) ListAgents() (map[string]any, error) {
	var out map[string]any
	return out, c.get("/api/v1/agents", nil, &out)
}
