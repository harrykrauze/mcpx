import { PresetSnippet } from '../types/mcp';

export const PRESET_SNIPPETS: PresetSnippet[] = [
  {
    id: 'test-case-1-resend',
    title: 'Test Case 1: Resend Email API (cURL)',
    category: 'cURL',
    language: 'typescript',
    serverName: 'resend-mcp',
    description: 'POST endpoint to send transactional HTML emails with Bearer token authentication.',
    snippet: `curl -X POST "https://api.resend.com/emails" \\
  -H "Authorization: Bearer re_123456789" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "onboarding@resend.dev",
    "to": "user@example.com",
    "subject": "Welcome to our platform!",
    "html": "<p>Thanks for signing up.</p>"
  }'`,
  },
  {
    id: 'test-case-2-weather',
    title: 'Test Case 2: Weather API (OpenAPI Fragment)',
    category: 'OpenAPI',
    language: 'typescript',
    serverName: 'weather-mcp',
    description: 'GET endpoint with city string query and optional units enum (metric/imperial).',
    snippet: `paths:
  /v1/weather/current:
    get:
      summary: Get current weather for a city
      parameters:
        - name: city
          in: query
          required: true
          schema:
            type: string
        - name: units
          in: query
          required: false
          schema:
            type: string
            enum: [metric, imperial]
            default: metric`,
  },
  {
    id: 'stripe-payment-intent',
    title: 'Stripe: Create Payment Intent (cURL)',
    category: 'cURL',
    language: 'typescript',
    serverName: 'stripe-mcp',
    description: 'Creates a Stripe PaymentIntent with amount, currency, and automatic payment methods.',
    snippet: `curl https://api.stripe.com/v1/payment_intents \\
  -u sk_test_51Mz0FakeSecretKey: \\
  -d amount=2000 \\
  -d currency=usd \\
  -d "payment_method_types[]"=card \\
  -d description="Subscription charge"`,
  },
  {
    id: 'github-issues-openapi',
    title: 'GitHub: Create Repository Issue (OpenAPI)',
    category: 'OpenAPI',
    language: 'typescript',
    serverName: 'github-issues-mcp',
    description: 'OpenAPI spec for creating a GitHub repo issue with title, body, and labels.',
    snippet: `paths:
  /repos/{owner}/{repo}/issues:
    post:
      summary: Create an issue
      parameters:
        - name: owner
          in: path
          required: true
          schema:
            type: string
        - name: repo
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - title
              properties:
                title:
                  type: string
                  description: The title of the issue.
                body:
                  type: string
                  description: The contents of the issue.
                labels:
                  type: array
                  items:
                    type: string`,
  },
  {
    id: 'slack-chat-post',
    title: 'Slack: Post Chat Message (cURL)',
    category: 'cURL',
    language: 'python',
    serverName: 'slack-mcp',
    description: 'Post a chat message to a Slack channel with Bearer token authentication.',
    snippet: `curl -X POST "https://slack.com/api/chat.postMessage" \\
  -H "Authorization: Bearer xoxb-your-token-here" \\
  -H "Content-type: application/json" \\
  --data '{
    "channel": "C1234567890",
    "text": "Hello world from Model Context Protocol!"
  }'`,
  },
];
