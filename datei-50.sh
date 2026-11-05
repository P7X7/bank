BODY='{"amount":1500,"currency":"SAR","sender_name":"محمد أحمد"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | sed 's/^.* //')
curl -X POST https://your-domain/webhook/rajhi \
  -H "content-type: application/json" \
  -H "x-webhook-signature: $SIG" \
  -d "$BODY"