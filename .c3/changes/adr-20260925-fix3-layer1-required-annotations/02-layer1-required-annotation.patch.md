---
target: rule-session-cwd-config-restored
scope: block
base: rule-session-cwd-config-restored#n2539@v1:sha256:01d50476d1f95e107e3e605a88db6c807fd0cfde5abd72daa41ca55bc8c54e11
---
ts
// REQUIRED (not defence in depth): the restore runs AFTER the session, so this refusal is the ONLY control over the intra-session window — spec §4.4 item 3 (a settings file written into cwd is reloaded within the WRITING session) and §4.3 m1b (a nested memory file loads on demand), both reachable by a ruling/ratify session that holds Write/Edit but has Bash in JUDGMENT_DISALLOWED_TOOLS. See the paragraph above.
  if (toolName === 'Write' || toolName === 'Edit') {
    const toolInput = (event.tool_input ?? {}) as { file_path?: unknown };
    const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
    const isInsideHome = filePath !== '' && containPath(filePath, homeDir);
    if (!isInsideHome) return deny();
    // The home is also the next session's settings root (spec §6.2): a configuration surface
    // written here would load as that session's configuration.
    const isConfigSurface = isHomeConfigSurface(relative(homeDir, normalize(filePath)));
    return isConfigSurface ? deny(HOME_CONFIG_DENIED_REASON) : {};
