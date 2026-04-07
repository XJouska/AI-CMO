import requests

API_KEY = "sk-cmo-NgFTCPJQvbTRLW0kMkyaTSGCJqmyhKnbB552kINSENM"
BASE = "https://www.aicmo.site/api/v1/open"
HEADERS = {"x-api-key": API_KEY, "Content-Type": "application/json"}

# 1. 查额度
r = requests.get(f"{BASE}/quota", headers=HEADERS)
print("Quota:", r.json())

# 2. 分析
r = requests.post(f"{BASE}/analyze", headers=HEADERS, json={
    "product": "u2foru.site",
    "language": "en",
    "max_results": 5
})
data = r.json()
print(f"Found {data.get('total_found')} results")
for p in data.get("promotions", []):
    print(f"  #{p['rank']} [{p['platform']}] {p['title'][:50]}")
    print(f"    URL: {p['url']}")
    print(f"    Comment: {(p.get('suggested_comment') or '')[:80]}...")