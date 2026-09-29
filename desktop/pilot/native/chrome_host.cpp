#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <wintrust.h>
#include <softpub.h>
#include <wincrypt.h>
#include <shlobj.h>
#include <tlhelp32.h>
#include <filesystem>
#include <string>
#include <vector>
#include <iostream>
#include <sstream>
#include <algorithm>
#include <cwctype>
#include "pilot_config.h"

namespace fs = std::filesystem;
static HWND parentWindow = nullptr, hostWindow = nullptr, chromeWindow = nullptr;
static HANDLE chromeJob = nullptr, chromeProcess = nullptr, parentProcess = nullptr, profileMutex = nullptr;
static DWORD chromePid = 0, parentPid = 0;
static std::wstring chromePath;
static bool stopRequested = false, parentClipAdded = false;
static int boxX = 0, boxY = 0, boxW = 0, boxH = 0;

static void emit(const char* event, const char* code = "") {
    std::cout << event;
    if (*code) std::cout << '\t' << code;
    std::cout << '\n' << std::flush;
}
static std::wstring lower(std::wstring value) {
    std::transform(value.begin(), value.end(), value.begin(), towlower); return value;
}
static bool digits(const std::wstring& value, int base) {
    return !value.empty() && value.size() <= 16 && std::all_of(value.begin(), value.end(), [base](wchar_t c) {
        return (c >= L'0' && c <= L'9') || (base == 16 && ((c >= L'a' && c <= L'f') || (c >= L'A' && c <= L'F')));
    });
}
static DWORD ownParentPid() {
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return 0;
    PROCESSENTRY32W entry{}; entry.dwSize = sizeof(entry); DWORD found = 0;
    if (Process32FirstW(snapshot, &entry)) do {
        if (entry.th32ProcessID == GetCurrentProcessId()) { found = entry.th32ParentProcessID; break; }
    } while (Process32NextW(snapshot, &entry));
    CloseHandle(snapshot); return found;
}
static bool verifyGoogleChrome(const std::wstring& executable) {
    WINTRUST_FILE_INFO file{}; file.cbStruct = sizeof(file); file.pcwszFilePath = executable.c_str();
    WINTRUST_DATA trust{}; trust.cbStruct = sizeof(trust); trust.dwUIChoice = WTD_UI_NONE;
    trust.fdwRevocationChecks = WTD_REVOKE_NONE; trust.dwUnionChoice = WTD_CHOICE_FILE;
    trust.pFile = &file; trust.dwStateAction = WTD_STATEACTION_VERIFY;
    // Certificate validation uses the local Windows trust cache; no network/reporting by this helper.
    trust.dwProvFlags = WTD_CACHE_ONLY_URL_RETRIEVAL;
    GUID action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    LONG valid = WinVerifyTrust(nullptr, &action, &trust);
    trust.dwStateAction = WTD_STATEACTION_CLOSE; WinVerifyTrust(nullptr, &action, &trust);
    if (valid != ERROR_SUCCESS) return false;
    HCERTSTORE store = nullptr; HCRYPTMSG message = nullptr;
    if (!CryptQueryObject(CERT_QUERY_OBJECT_FILE, executable.c_str(), CERT_QUERY_CONTENT_FLAG_PKCS7_SIGNED_EMBED,
        CERT_QUERY_FORMAT_FLAG_BINARY, 0, nullptr, nullptr, nullptr, &store, &message, nullptr)) return false;
    DWORD size = 0; bool publisherOk = false;
    if (CryptMsgGetParam(message, CMSG_SIGNER_INFO_PARAM, 0, nullptr, &size) && size < 1048576) {
        std::vector<BYTE> buffer(size);
        if (CryptMsgGetParam(message, CMSG_SIGNER_INFO_PARAM, 0, buffer.data(), &size)) {
            auto signer = reinterpret_cast<CMSG_SIGNER_INFO*>(buffer.data());
            CERT_INFO subject{}; subject.Issuer = signer->Issuer; subject.SerialNumber = signer->SerialNumber;
            PCCERT_CONTEXT cert = CertFindCertificateInStore(store, X509_ASN_ENCODING | PKCS_7_ASN_ENCODING,
                0, CERT_FIND_SUBJECT_CERT, &subject, nullptr);
            if (cert) {
                wchar_t name[512]{};
                CertGetNameStringW(cert, CERT_NAME_SIMPLE_DISPLAY_TYPE, 0, nullptr, name, 512);
                auto publisher = lower(name);
                publisherOk = publisher == L"google llc" || publisher == L"google inc" || publisher == L"google inc.";
                CertFreeCertificateContext(cert);
            }
        }
    }
    if (message) CryptMsgClose(message);
    if (store) CertCloseStore(store, 0);
    return publisherOk;
}
static bool ownedChrome(HWND window) {
    if (!IsWindow(window) || !chromeJob) return false;
    DWORD pid = 0; GetWindowThreadProcessId(window, &pid);
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!process) return false;
    BOOL inJob = FALSE; wchar_t path[32768]{}; DWORD length = 32768;
    bool valid = IsProcessInJob(process, chromeJob, &inJob) && inJob &&
        QueryFullProcessImageNameW(process, 0, path, &length) && lower(path) == lower(chromePath);
    CloseHandle(process); return valid;
}
static BOOL CALLBACK findChrome(HWND window, LPARAM) {
    if (!IsWindowVisible(window) || GetWindow(window, GW_OWNER) || !ownedChrome(window)) return TRUE;
    wchar_t className[128]{}; GetClassNameW(window, className, 128);
    if (std::wstring(className) != L"Chrome_WidgetWin_1") return TRUE;
    chromeWindow = window; return FALSE;
}
static void fitChrome() {
    if (!IsWindow(hostWindow) || !ownedChrome(chromeWindow)) return;
    RECT r{}; GetClientRect(hostWindow, &r);
    SetWindowPos(chromeWindow, HWND_TOP, 0, 0, std::max<LONG>(1, r.right), std::max<LONG>(1, r.bottom),
        SWP_NOACTIVATE | SWP_SHOWWINDOW);
}
static void moveHost() {
    if (!IsWindow(hostWindow) || !IsWindow(parentWindow)) return;
    if (boxW == 0 || boxH == 0) { ShowWindow(hostWindow, SW_HIDE); return; }
    const UINT dpi = GetDpiForWindow(parentWindow);
    auto px = [dpi](int value) { return MulDiv(value, dpi ? static_cast<int>(dpi) : 96, 96); };
    RECT client{}; GetClientRect(parentWindow, &client);
    int x = px(boxX), y = px(boxY);
    int width = std::min(px(boxW), static_cast<int>(client.right) - x);
    int height = std::min(px(boxH), static_cast<int>(client.bottom) - y);
    if (width < 1 || height < 1) { ShowWindow(hostWindow, SW_HIDE); return; }
    SetWindowPos(hostWindow, HWND_TOP, x, y, width, height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    fitChrome();
}
static void focusChrome() {
    if (!ownedChrome(chromeWindow) || !IsWindowVisible(hostWindow)) return;
    DWORD thread = GetWindowThreadProcessId(chromeWindow, nullptr);
    DWORD own = GetCurrentThreadId();
    if (thread != own && !AttachThreadInput(own, thread, TRUE)) return;
    SetFocus(chromeWindow);
    if (thread != own) AttachThreadInput(own, thread, FALSE);
}
static LRESULT CALLBACK hostProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (msg == WM_SIZE) { fitChrome(); return 0; }
    if (msg == WM_SETFOCUS) { focusChrome(); return 0; }
    if (msg == WM_DPICHANGED) { moveHost(); return 0; }
    if (msg == WM_CLOSE) { stopRequested = true; return 0; }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}
static bool attachChrome() {
    SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(parentWindow));
    WNDCLASSW klass{}; klass.lpfnWndProc = hostProc; klass.hInstance = GetModuleHandleW(nullptr);
    klass.lpszClassName = L"AltaPulseOwnedChromeHost"; klass.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
    if (!RegisterClassW(&klass) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return false;
    LONG_PTR parentStyle = GetWindowLongPtrW(parentWindow, GWL_STYLE);
    parentClipAdded = !(parentStyle & WS_CLIPCHILDREN);
    SetWindowLongPtrW(parentWindow, GWL_STYLE, parentStyle | WS_CLIPCHILDREN);
    hostWindow = CreateWindowExW(0, klass.lpszClassName, L"Alta Pulse Chrome Pilot",
        WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS, 0, 0, 1, 1, parentWindow, nullptr, klass.hInstance, nullptr);
    if (!hostWindow || !ownedChrome(chromeWindow)) return false;
    LONG_PTR style = GetWindowLongPtrW(chromeWindow, GWL_STYLE);
    style &= ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU);
    style |= WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS;
    SetLastError(0);
    if (!SetWindowLongPtrW(chromeWindow, GWL_STYLE, style) && GetLastError() != 0) return false;
    SetLastError(0); SetParent(chromeWindow, hostWindow);
    if (GetLastError() != 0 || GetParent(chromeWindow) != hostWindow || GetParent(hostWindow) != parentWindow) return false;
    SetWindowPos(chromeWindow, HWND_TOP, 0, 0, 1, 1, SWP_NOACTIVATE | SWP_FRAMECHANGED);
    moveHost();
    return true;
}
static std::wstring quoteArgument(const std::wstring& input) {
    // Paths come from fixed OS locations; quotes/newlines are refused before calling CreateProcess.
    return L"\"" + input + L"\"";
}
static bool launchChrome(const std::wstring& profile) {
    chromeJob = CreateJobObjectW(nullptr, nullptr);
    if (!chromeJob) return false;
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(chromeJob, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) return false;
    std::wstring command = quoteArgument(chromePath) + L" " + quoteArgument(L"--user-data-dir=" + profile) + L" " + quoteArgument(L"--app=" + std::wstring(PILOT_LOGIN_URL));
    STARTUPINFOW startup{}; startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(chromePath.c_str(), command.data(), nullptr, nullptr, FALSE, CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
        nullptr, fs::path(chromePath).parent_path().c_str(), &startup, &process)) return false;
    chromeProcess = process.hProcess; chromePid = process.dwProcessId;
    if (!AssignProcessToJobObject(chromeJob, chromeProcess)) {
        TerminateProcess(chromeProcess, 1); CloseHandle(process.hThread); return false;
    }
    ResumeThread(process.hThread); CloseHandle(process.hThread); return true;
}
static bool boundedInteger(const std::string& text, int& value) {
    if (text.empty() || text.size() > 5 || !std::all_of(text.begin(), text.end(), [](char c){ return c >= '0' && c <= '9'; })) return false;
    value = std::stoi(text); return value <= 20000;
}
static bool safeDirectory(const fs::path& directory) {
    DWORD attributes = GetFileAttributesW(directory.c_str());
    if (attributes == INVALID_FILE_ATTRIBUTES) return CreateDirectoryW(directory.c_str(), nullptr) != FALSE;
    return (attributes & FILE_ATTRIBUTE_DIRECTORY) && !(attributes & FILE_ATTRIBUTE_REPARSE_POINT);
}
static bool command(const std::string& line) {
    if (line == "CLOSE") { stopRequested = true; return true; }
    if (line == "FOCUS") { focusChrome(); return true; }
    std::vector<std::string> parts; std::stringstream stream(line); std::string part;
    while (std::getline(stream, part, '\t')) parts.push_back(part);
    int x, y, w, h;
    if (parts.size() != 5 || parts[0] != "BOUNDS" || !boundedInteger(parts[1], x) || !boundedInteger(parts[2], y) ||
        !boundedInteger(parts[3], w) || !boundedInteger(parts[4], h)) return false;
    boxX = x; boxY = y; boxW = w; boxH = h; moveHost(); return true;
}
static bool pumpPipe(std::string& pending) {
    HANDLE input = GetStdHandle(STD_INPUT_HANDLE); DWORD count = 0;
    if (!PeekNamedPipe(input, nullptr, 0, nullptr, &count, nullptr)) return false;
    while (count > 0) {
        char data[128]; DWORD read = 0;
        if (!ReadFile(input, data, std::min<DWORD>(count, sizeof(data)), &read, nullptr) || read == 0) return false;
        pending.append(data, read);
        size_t next;
        while ((next = pending.find('\n')) != std::string::npos) {
            std::string line = pending.substr(0, next); pending.erase(0, next + 1);
            if (line.size() > 128 || !command(line)) { emit("ERROR", "protocol_invalid"); return false; }
        }
        if (pending.size() > 128) return false;
        if (!PeekNamedPipe(input, nullptr, 0, nullptr, &count, nullptr)) return false;
    }
    return true;
}
static void cleanup() {
    if (ownedChrome(chromeWindow)) {
        PostMessageW(chromeWindow, WM_CLOSE, 0, 0);
        ULONGLONG deadline = GetTickCount64() + 2000;
        while (IsWindow(chromeWindow) && GetTickCount64() < deadline) {
            MSG msg; while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
            Sleep(25);
        }
    }
    if (chromeJob) { CloseHandle(chromeJob); chromeJob = nullptr; } // Only our newly created process tree.
    if (chromeProcess) CloseHandle(chromeProcess);
    if (hostWindow && IsWindow(hostWindow)) DestroyWindow(hostWindow);
    if (parentClipAdded && IsWindow(parentWindow)) SetWindowLongPtrW(parentWindow, GWL_STYLE, GetWindowLongPtrW(parentWindow, GWL_STYLE) & ~WS_CLIPCHILDREN);
    if (parentProcess) CloseHandle(parentProcess);
    if (profileMutex) { ReleaseMutex(profileMutex); CloseHandle(profileMutex); }
}
int wmain(int argc, wchar_t** argv) {
    try {
        if (argc != 9 || std::wstring(argv[1]) != L"--parent" || std::wstring(argv[3]) != L"--parent-pid" ||
            std::wstring(argv[5]) != L"--chrome" || std::wstring(argv[7]) != L"--profile-key" ||
            !digits(argv[2], 16) || !digits(argv[4], 10)) { emit("ERROR", "arguments_invalid"); return 2; }
        parentWindow = reinterpret_cast<HWND>(static_cast<uintptr_t>(std::stoull(argv[2], nullptr, 16)));
        parentPid = static_cast<DWORD>(std::stoul(argv[4]));
        DWORD windowPid = 0; GetWindowThreadProcessId(parentWindow, &windowPid);
        if (!IsWindow(parentWindow) || windowPid != parentPid || ownParentPid() != parentPid) { emit("ERROR", "parent_invalid"); return 2; }
        parentProcess = OpenProcess(SYNCHRONIZE, FALSE, parentPid);
        if (!parentProcess) { emit("ERROR", "parent_invalid"); return 2; }
        std::wstring key = argv[8];
        if (key.size() != 64 || !std::all_of(key.begin(), key.end(), [](wchar_t c){ return (c >= L'0' && c <= L'9') || (c >= L'a' && c <= L'f'); })) { emit("ERROR", "profile_invalid"); cleanup(); return 2; }
        chromePath = fs::canonical(argv[6]).wstring();
        if (chromePath.find_first_of(L"\"\r\n") != std::wstring::npos || lower(fs::path(chromePath).filename().wstring()) != L"chrome.exe" || !verifyGoogleChrome(chromePath)) {
            emit("ERROR", "chrome_signature_invalid"); cleanup(); return 3;
        }
        PWSTR roaming = nullptr;
        if (FAILED(SHGetKnownFolderPath(FOLDERID_RoamingAppData, 0, nullptr, &roaming))) { emit("ERROR", "profile_unavailable"); cleanup(); return 3; }
        fs::path base = fs::path(roaming) / L"Alta Pulse Chrome Pilot";
        fs::path root = base / L"ChromeProfiles";
        CoTaskMemFree(roaming);
        fs::path profile = root / key;
        if (!safeDirectory(base) || !safeDirectory(root) || !safeDirectory(profile) || fs::canonical(profile).parent_path() != fs::canonical(root)) {
            emit("ERROR", "profile_invalid"); cleanup(); return 3;
        }
        SetLastError(0);
        profileMutex = CreateMutexW(nullptr, TRUE, (L"Local\\AltaPulseChromePilot-" + key).c_str());
        if (!profileMutex || GetLastError() == ERROR_ALREADY_EXISTS) { emit("ERROR", "profile_in_use"); cleanup(); return 3; }
        if (!launchChrome(profile.wstring())) { emit("ERROR", "chrome_start_failed"); cleanup(); return 4; }
        ULONGLONG deadline = GetTickCount64() + 20000; std::string pending;
        while (!chromeWindow && !stopRequested && GetTickCount64() < deadline && WaitForSingleObject(parentProcess, 0) == WAIT_TIMEOUT) {
            if (!pumpPipe(pending)) { stopRequested = true; break; }
            EnumWindows(findChrome, 0); Sleep(60);
        }
        if (stopRequested) { cleanup(); emit("CLOSED"); return 0; }
        if (!chromeWindow) { emit("ERROR", "chrome_window_not_found"); cleanup(); return 4; }
        if (!attachChrome()) { emit("ERROR", "attach_failed"); cleanup(); return 5; }
        emit("READY"); // Only after verified HWND parentage, not merely after process launch.
        UINT lastDpi = GetDpiForWindow(parentWindow);
        while (!stopRequested && IsWindow(parentWindow) && ownedChrome(chromeWindow) && WaitForSingleObject(parentProcess, 0) == WAIT_TIMEOUT) {
            MSG msg; while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
            if (!pumpPipe(pending)) break;
            UINT dpi = GetDpiForWindow(parentWindow); if (dpi != lastDpi) { lastDpi = dpi; moveHost(); }
            if (GetParent(chromeWindow) != hostWindow) { emit("ERROR", "embedding_lost"); break; }
            Sleep(25);
        }
        cleanup(); emit("CLOSED"); return 0;
    } catch (...) { emit("ERROR", "native_failure"); cleanup(); return 9; }
}