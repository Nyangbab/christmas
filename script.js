const ADMIN_AUTH_STORAGE_KEY = "christmas_advent_admin_pass_v1";
let adminPasswordCache = sessionStorage.getItem(ADMIN_AUTH_STORAGE_KEY) || "";

function isAdminLoggedIn() {
    return Boolean(adminPasswordCache);
}

function updateAdminUI() {
    const loggedIn = isAdminLoggedIn();
    document.getElementById("admin-badge").classList.toggle("hidden", !loggedIn);
    document.getElementById("admin-user-panel").classList.toggle("hidden", !loggedIn);
    document.getElementById("admin-toggle-text").textContent = loggedIn ? "관리자 활성" : "관리자 로그인";
    renderAdminUserList();
}

function renderAdminUserList() {
    const listEl = document.getElementById("admin-user-list");
    if (!listEl) return;
    if (!isAdminLoggedIn()) {
        listEl.innerHTML = "";
        return;
    }
    if (registeredUsers.length === 0) {
        listEl.innerHTML = `<span class="text-xs text-slate-400">등록된 이름이 없습니다.</span>`;
        return;
    }

    listEl.innerHTML = registeredUsers.map((u) => {
        const safeName = u.nickname.replace(/"/g, "&quot;");
        return `
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/90 border border-white/15 text-xs text-slate-100">
                <span>${u.nickname}</span>
                <button type="button" data-delete-user="${safeName}"
                    class="text-rose-300 hover:text-rose-100 font-bold px-1" title="${safeName} 삭제">
                    ✕
                </button>
            </span>
        `;
    }).join("");

    listEl.querySelectorAll("[data-delete-user]").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const target = btn.getAttribute("data-delete-user");
            await deleteUserAsAdmin(target);
        });
    });
}

async function handleAdminLogin() {
    const inputPass = window.prompt("관리자 비밀번호를 입력하세요:");
    if (!inputPass) return;

    try {
        // 존재하지 않는 더미 닉네임으로 검증 호출 시 비밀번호가 틀리면 false, 맞으면 false(대상 없음) 반환
        // 실제 검증은 삭제 시 또는 별도 RPC로 처리하며, 여기서는 비밀번호를 세션에 보관
        adminPasswordCache = inputPass;
        sessionStorage.setItem(ADMIN_AUTH_STORAGE_KEY, inputPass);
        updateAdminUI();
        showToast("관리자 모드가 활성화되었습니다.", "🛡️");
    } catch (err) {
        console.error("관리자 로그인 실패:", err);
        showToast("관리자 인증 중 오류가 발생했습니다.", "⚠️");
    }
}

function handleAdminLogout() {
    adminPasswordCache = "";
    sessionStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
    updateAdminUI();
    showToast("관리자 로그아웃되었습니다.", "🔓");
}

async function deleteUserAsAdmin(targetNickname) {
    if (!isAdminLoggedIn()) {
        showToast("관리자만 이름을 지울 수 있습니다.", "⚠️");
        return;
    }

    try {
        const ok = await sbFetch("/rpc/delete_user_as_admin", {
            method: "POST",
            body: JSON.stringify({
                target_nickname: targetNickname,
                admin_password: adminPasswordCache
            })
        });

        if (!ok) {
            adminPasswordCache = "";
            sessionStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
            updateAdminUI();
            showToast("관리자 비밀번호가 올바르지 않거나 대상을 찾을 수 없습니다.", "⚠️");
            return;
        }

        if (getMyNickname() === targetNickname) {
            setMyNickname("");
        }

        await loadRegisteredUsers();
        showToast(`"${targetNickname}" 이름이 삭제되었습니다.`, "🗑️");
    } catch (err) {
        console.error("이름 삭제 실패:", err);
        showToast("이름 삭제 중 오류가 발생했습니다.", "⚠️");
    }
}

async function registerNickname(nickname) {
    const cleaned = nickname.trim();
    if (!cleaned) {
        showToast("이름을 입력해 주세요.", "⚠️");
        return;
    }

    const currentName = getMyNickname();

    try {
        // 1. 이미 등록된 이름인지 확인 (대소문자/공백 정리 기준)
        const duplicates = await sbFetch(
            `/advent_users?select=id,nickname&nickname=eq.${encodeURIComponent(cleaned)}`
        );
        const isDuplicate = Array.isArray(duplicates) && duplicates.length > 0;

        if (isDuplicate) {
            if (currentName && currentName === cleaned) {
                showToast("현재 사용 중인 이름과 같습니다.", "ℹ️");
            } else {
                showToast(`"${cleaned}" 이름은 이미 사용 중입니다. 다른 이름을 입력해 주세요.`, "⚠️");
            }
            return;
        }

        // 2. 기존 내 이름이 있다면 새 이름으로 변경(PATCH), 없다면 신규 등록(POST)
        if (currentName) {
            const updatedRows = await sbFetch(
                `/advent_users?nickname=eq.${encodeURIComponent(currentName)}`,
                {
                    method: "PATCH",
                    headers: { "Prefer": "return=representation" },
                    body: JSON.stringify({ nickname: cleaned })
                }
            );

            // 기존 행이 DB에 없었던 경우 대비
            if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
                await sbFetch("/advent_users", {
                    method: "POST",
                    headers: { "Prefer": "return=representation" },
                    body: JSON.stringify({ nickname: cleaned })
                });
            } else {
                // 기존 이름으로 보낸/받은 명언 기록의 이름도 함께 갱신
                await sbFetch(`/advent_quotes?sender=eq.${encodeURIComponent(currentName)}`, {
                    method: "PATCH",
                    body: JSON.stringify({ sender: cleaned })
                });
                await sbFetch(`/advent_quotes?recipient=eq.${encodeURIComponent(currentName)}`, {
                    method: "PATCH",
                    body: JSON.stringify({ recipient: cleaned })
                });
            }

            setMyNickname(cleaned);
            document.getElementById("nickname-input").value = "";
            await loadRegisteredUsers();
            showToast(`이름이 "${currentName}"에서 "${cleaned}"(으)로 변경되었습니다.`, "✅");
        } else {
            await sbFetch("/advent_users", {
                method: "POST",
                headers: { "Prefer": "return=representation" },
                body: JSON.stringify({ nickname: cleaned })
            });

            setMyNickname(cleaned);
            document.getElementById("nickname-input").value = "";
            await loadRegisteredUsers();
            showToast(`"${cleaned}" 이름이 서버에 등록되었습니다.`, "✅");
        }
    } catch (err) {
        console.error("이름 등록/변경 실패:", err);
        showToast("이름 처리 중 오류가 발생했습니다.", "⚠️");
    }
}
