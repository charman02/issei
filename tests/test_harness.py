def test_health_and_auth_smoke(client, make_user):
    # health is unauthenticated
    assert client.get("/health").json() == {"status": "ok"}
    # auth wiring works end to end
    user, headers = make_user()
    me = client.get("/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email"] == user.email
