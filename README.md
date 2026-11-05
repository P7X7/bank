# BANK — نظام التحقق من الحوالات والإيصالات المالية

نظام متكامل يربط بوت Discord بلوحة تحكم ويب وقاعدة بيانات، للتحقق من صحة إيصالات
التحويل بمطابقتها مع حوالات مسجلة عبر Webhook الرسائل البنكية، مع قراءة الإيصالات
بواسطة Anthropic API.

## المكوّنات

| المكوّن | المسار |
|---|---|
| البوت | `src/discord/` |
| Webhook البنك | `src/webhook/router.js` |
| قراءة الإيصالات (AI) | `src/ai/receiptReader.js` |
| محرك المطابقة | `src/services/matching.js` |
| قاعدة البيانات | `src/db/index.js` |
| لوحة التحكم | `src/public/` + `src/web/routes/` |
| المصادقة | `src/web/auth.js` |
| الإعدادات | `src/config.js` + `src/services/settings.js` |

## التشغيل المحلي

```bash
npm install
cp .env.example .env
# عدّل .env وأضف DISCORD_TOKEN و DISCORD_CLIENT_ID و ANTHROPIC_API_KEY
npm start