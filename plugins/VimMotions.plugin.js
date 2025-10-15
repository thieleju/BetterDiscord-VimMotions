/**
 * @name VimMotions
 * @author github.com/thieleju
 * @description Minimal Vim motions for Discord using Ace Editor's Vim mode (draft logic removed)
 * @version 1.0.0
 */

const React = BdApi.React;

module.exports = class VimMotionsPlugin {
  constructor(meta) {
    this.meta = meta;
    this.config = null;
    this.aceEditors = new Map(); // Map input elements to their Ace editor instances
    this.observer = null;
    this.activeInputs = new Set();
    this.currentMode = "insert";
    this.onModeChange = null;
    this.aceLoaded = false;
    this.draftCache = new Map(); // Cache channel ID -> draft content
    this.channelChangeUnsubscribe = null; // Flux dispatcher unsubscribe function
    this.draftChangeUnsubscribe = null; // For emoji picker support
    this.lastProcessedDraft = new Map(); // Track last processed draft to avoid duplicates

    this.defaultConfig = {
      debugMode: false,
      fontSize: 16,
      fontFamily: "Consolas",
      fontColor: "#e3e3e3",
      backgroundColor: "#222327",
      cursorColor: "#a52327",
      highlightActiveLine: false,
      sendInInsertMode: false,
      sendInNormalMode: true,
    };

    this.customMappings = [];

    // Discord modules for sending/editing messages and draft management
    this.dcModules = {
      SelectedChannelStore: BdApi.Webpack.getModule(
        BdApi.Webpack.Filters.byProps("getChannelId", "getVoiceChannelId")
      ),
      MessageActions: BdApi.Webpack.getModule(
        (m) => m.sendMessage && m.receiveMessage
      ),
      MessageStore: BdApi.Webpack.getModule(
        BdApi.Webpack.Filters.byKeys("receiveMessage", "editMessage")
      ),
      DraftActions: BdApi.Webpack.getModule(
        (m) => m.changeDraft || m.saveDraft || m.clearDraft
      ),
      DraftStore: BdApi.Webpack.getModule(
        (m) => m.getDraft && m.getRecentlyEditedDrafts
      ),
    };
  }

  async start() {
    this.log("Starting VimMotions with Ace Editor...");
    this.loadConfig();
    await this.loadAceEditor();

    if (!this.aceLoaded) {
      BdApi.UI.showToast("[VimMotions] Failed to load Ace Editor", {
        type: "error",
      });
      return;
    }

    this.setupChannelChangeListener();
    this.setupDraftChangeListener();
    this.addStyles();
    this.startObserving();
    this.log("VimMotions Started");
  }

  stop() {
    this.log("Stopping VimMotions...");

    // Unsubscribe from channel change events
    if (this.channelChangeUnsubscribe) {
      try {
        this.channelChangeUnsubscribe();
        this.log("Unsubscribed from channel change events");
      } catch (e) {
        this.log(
          `Error unsubscribing from channel changes: ${e.message}`,
          "warn"
        );
      }
      this.channelChangeUnsubscribe = null;
    }

    // Unsubscribe from draft change events
    if (this.draftChangeUnsubscribe) {
      try {
        this.draftChangeUnsubscribe();
        this.log("Unsubscribed from draft change events");
      } catch (e) {
        this.log(
          `Error unsubscribing from draft changes: ${e.message}`,
          "warn"
        );
      }
      this.draftChangeUnsubscribe = null;
    }

    // Clear draft cache
    if (this.draftCache) {
      this.draftCache.clear();
    }

    // Clear last processed draft tracking
    if (this.lastProcessedDraft) {
      this.lastProcessedDraft.clear();
    }

    // Destroy all Ace editors
    this.aceEditors.forEach((_, originalInput) => {
      try {
        this.destroyAceEditor(originalInput);
      } catch (e) {
        this.log(`Error destroying editor: ${e.message}`, "warn");
      }
    });
    this.aceEditors.clear();
    this.activeInputs.clear();

    // Disconnect mutation observer
    if (this.observer) {
      try {
        this.observer.disconnect();
      } catch (e) {}
      this.observer = null;
    }

    // Unpatch Discord modules
    try {
      BdApi.Patcher.unpatchAll(this.meta.name);
    } catch (e) {}

    // Remove custom styles
    BdApi.DOM.removeStyle("VimMotions");

    // Remove Ace from window if we loaded it
    if (window.ace) {
      try {
        delete window.ace;
      } catch (e) {}
    }
  }

  // Ace Editor Loading

  async loadAceEditor() {
    if (window.ace) {
      this.aceLoaded = true;
      return;
    }

    try {
      await this.loadScript(
        "https://cdn.jsdelivr.net/npm/ace-builds@1.43.3/src-min-noconflict/ace.js"
      );

      if (window.ace) {
        window.ace.config.set(
          "basePath",
          "https://cdn.jsdelivr.net/npm/ace-builds@1.43.3/src-min-noconflict/"
        );

        await this.loadScript(
          "https://cdn.jsdelivr.net/npm/ace-builds@1.43.3/src-min-noconflict/keybinding-vim.js"
        );

        this.aceLoaded = true;
        this.log("Ace Editor loaded successfully");
      }
    } catch (e) {
      this.log(`Failed to load Ace Editor: ${e.message}`, "error");
      this.aceLoaded = false;
    }
  }

  loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(script);
    });
  }

  // Configuration

  loadConfig() {
    const saved = BdApi.Data.load(this.meta.name, "config");

    if (saved) {
      this.config = {
        debugMode:
          saved.settings?.debugMode ??
          saved.debugMode ??
          this.defaultConfig.debugMode,
        fontSize:
          saved.settings?.fontSize ??
          saved.fontSize ??
          this.defaultConfig.fontSize,
        fontFamily:
          saved.settings?.fontFamily ??
          saved.fontFamily ??
          this.defaultConfig.fontFamily,
        fontColor:
          saved.settings?.fontColor ??
          saved.fontColor ??
          this.defaultConfig.fontColor,
        backgroundColor:
          saved.settings?.backgroundColor ??
          saved.backgroundColor ??
          this.defaultConfig.backgroundColor,
        cursorColor:
          saved.settings?.cursorColor ??
          saved.cursorColor ??
          this.defaultConfig.cursorColor,
        highlightActiveLine:
          saved.settings?.highlightActiveLine ??
          saved.highlightActiveLine ??
          this.defaultConfig.highlightActiveLine,
        sendInInsertMode:
          saved.settings?.sendInInsertMode ??
          saved.sendInInsertMode ??
          this.defaultConfig.sendInInsertMode,
        sendInNormalMode:
          saved.settings?.sendInNormalMode ??
          saved.sendInNormalMode ??
          this.defaultConfig.sendInNormalMode,
      };

      this.customMappings =
        saved.customMappings ?? saved.settings?.customMappings ?? [];
    } else {
      this.config = this.defaultConfig;
      this.customMappings = [];
    }

    this.saveConfig();
  }

  saveConfig() {
    const dataToSave = {
      debugMode: this.config.debugMode,
      fontSize: this.config.fontSize,
      fontFamily: this.config.fontFamily,
      fontColor: this.config.fontColor,
      backgroundColor: this.config.backgroundColor,
      cursorColor: this.config.cursorColor,
      highlightActiveLine: this.config.highlightActiveLine,
      sendInInsertMode: this.config.sendInInsertMode,
      sendInNormalMode: this.config.sendInNormalMode,
      customMappings: this.customMappings,
    };
    BdApi.Data.save(this.meta.name, "config", dataToSave);
  }

  getSettingsPanel() {
    try {
      const { useState } = React;
      const { SettingItem, SwitchInput, TextInput } = BdApi.Components;

      return () => {
        const [config, setConfig] = useState(this.config);
        const [customMappings, setCustomMappings] = useState(
          this.customMappings || []
        );
        const [newMappingKeys, setNewMappingKeys] = useState("");
        const [newMappingAction, setNewMappingAction] = useState("");
        const [newMappingTimeout, setNewMappingTimeout] = useState("normal");

        const updateConfig = (key, value) => {
          const newConfig = {
            debugMode: key === "debugMode" ? value : config.debugMode,
            fontSize: key === "fontSize" ? value : config.fontSize,
            fontFamily: key === "fontFamily" ? value : config.fontFamily,
            fontColor: key === "fontColor" ? value : config.fontColor,
            backgroundColor:
              key === "backgroundColor" ? value : config.backgroundColor,
            cursorColor: key === "cursorColor" ? value : config.cursorColor,
            highlightActiveLine:
              key === "highlightActiveLine"
                ? value
                : config.highlightActiveLine,
            sendInInsertMode:
              key === "sendInInsertMode" ? value : config.sendInInsertMode,
            sendInNormalMode:
              key === "sendInNormalMode" ? value : config.sendInNormalMode,
          };
          setConfig(newConfig);
          this.config = newConfig;
          this.saveConfig();

          if (
            [
              "fontSize",
              "fontFamily",
              "fontColor",
              "backgroundColor",
              "cursorColor",
              "highlightActiveLine",
            ].includes(key)
          ) {
            this.addStyles();
            this.aceEditors.forEach((editorData, originalInput) => {
              this.applyEditorSettings(editorData.editor, originalInput);
              editorData.editor.resize(true);
              if (key === "fontSize") {
                editorData.editor.renderer.updateFull(true);
                const content = editorData.editor.getValue();
                editorData.editor.setValue(content + " ", -1);
                setTimeout(() => {
                  editorData.editor.setValue(content, -1);
                  editorData.editor.navigateFileEnd();
                }, 10);
              }
            });
          }
        };

        if (!SettingItem || !SwitchInput) {
          return React.createElement(
            "div",
            { style: { padding: "20px", color: "var(--text-normal)" } },
            React.createElement(
              "p",
              null,
              "Failed to load Discord components. Please restart Discord."
            )
          );
        }

        return React.createElement(
          "div",
          null,
          React.createElement(
            SettingItem,
            {
              name: "Font Size",
              note: "Editor font size in pixels. 16 is default for monospace fonts.",
            },
            TextInput
              ? React.createElement(TextInput, {
                  type: "number",
                  value: config.fontSize,
                  placeholder: "16",
                  onChange: (value) =>
                    updateConfig("fontSize", parseInt(value) || 14),
                })
              : React.createElement("input", {
                  type: "number",
                  value: config.fontSize,
                  placeholder: "16",
                  min: "5",
                  max: "50",
                  onChange: (e) =>
                    updateConfig("fontSize", parseInt(e.target.value) || 14),
                  className: "inputDefault-3FGxgL input-2g-os5",
                  style: { width: "100%" },
                })
          ),
          React.createElement(
            SettingItem,
            {
              name: "Font Family",
              note: "Font family for the editor (e.g., Consolas, Monaco, Courier New)",
            },
            TextInput
              ? React.createElement(TextInput, {
                  value: config.fontFamily,
                  placeholder: "Consolas",
                  onChange: (value) =>
                    updateConfig("fontFamily", value || "Consolas"),
                })
              : React.createElement("input", {
                  type: "text",
                  value: config.fontFamily,
                  placeholder: "Consolas",
                  onChange: (e) =>
                    updateConfig("fontFamily", e.target.value || "Consolas"),
                  className: "inputDefault-3FGxgL input-2g-os5",
                  style: { width: "100%" },
                })
          ),
          React.createElement(
            SettingItem,
            {
              name: "Font Color",
              note: "Color of the text in the editor",
              inline: true,
            },
            React.createElement("input", {
              type: "color",
              value: config.fontColor,
              onChange: (e) => updateConfig("fontColor", e.target.value),
              style: {
                width: "60px",
                height: "30px",
                border: "none",
                borderRadius: "3px",
                cursor: "pointer",
              },
            })
          ),
          React.createElement(
            SettingItem,
            {
              name: "Background Color",
              note: "Background color of the editor",
              inline: true,
            },
            React.createElement("input", {
              type: "color",
              value: config.backgroundColor,
              onChange: (e) => updateConfig("backgroundColor", e.target.value),
              style: {
                width: "60px",
                height: "30px",
                border: "none",
                borderRadius: "3px",
                cursor: "pointer",
              },
            })
          ),
          React.createElement(
            SettingItem,
            {
              name: "Cursor Color",
              note: "Color of the Vim cursor",
              inline: true,
            },
            React.createElement("input", {
              type: "color",
              value: config.cursorColor,
              onChange: (e) => updateConfig("cursorColor", e.target.value),
              style: {
                width: "60px",
                height: "30px",
                border: "none",
                borderRadius: "3px",
                cursor: "pointer",
              },
            })
          ),
          React.createElement(
            SettingItem,
            {
              name: "Highlight Active Line",
              note: "Highlight the line where the cursor is",
              inline: true,
            },
            React.createElement(SwitchInput, {
              value: config.highlightActiveLine,
              onChange: (v) => updateConfig("highlightActiveLine", v),
            })
          ),
          React.createElement(
            SettingItem,
            {
              name: "Send with Enter in Insert Mode",
              note: "Send message when pressing Enter in insert mode (Shift+Enter for new line)",
              inline: true,
            },
            React.createElement(SwitchInput, {
              value: config.sendInInsertMode,
              onChange: (v) => updateConfig("sendInInsertMode", v),
            })
          ),
          React.createElement(
            SettingItem,
            {
              name: "Send with Enter in Normal Mode",
              note: "Send message when pressing Enter in normal mode",
              inline: true,
            },
            React.createElement(SwitchInput, {
              value: config.sendInNormalMode,
              onChange: (v) => updateConfig("sendInNormalMode", v),
            })
          ),
          React.createElement(
            SettingItem,
            {
              name: "Debug Mode",
              note: "Show debug messages as toasts",
              inline: true,
            },
            React.createElement(SwitchInput, {
              value: config.debugMode,
              onChange: (v) => updateConfig("debugMode", v),
            })
          ),
          // Custom mappings UI unchanged...
          React.createElement(
            "div",
            {
              style: {
                marginTop: "20px",
                paddingTop: "20px",
                borderTop: "1px solid var(--background-modifier-accent)",
              },
            },
            React.createElement(
              "h3",
              {
                style: {
                  color: "var(--header-primary)",
                  fontSize: "16px",
                  fontWeight: "600",
                  marginBottom: "10px",
                },
              },
              "Custom Vim Key Mappings"
            ),
            React.createElement(
              "div",
              {
                style: {
                  color: "var(--text-muted)",
                  fontSize: "14px",
                  marginBottom: "15px",
                },
              },
              "Define custom Vim key mappings (e.g., map 'j' to 'gj' in normal mode)"
            ),
            customMappings.length > 0 &&
              React.createElement(
                "div",
                { style: { marginBottom: "15px" } },
                customMappings.map((mapping, index) =>
                  React.createElement(
                    "div",
                    {
                      key: index,
                      style: {
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "10px",
                        backgroundColor: "var(--background-secondary)",
                        borderRadius: "3px",
                        marginBottom: "8px",
                      },
                    },
                    React.createElement(
                      "div",
                      { style: { flex: 1 } },
                      React.createElement(
                        "div",
                        {
                          style: {
                            color: "var(--header-primary)",
                            fontWeight: "500",
                          },
                        },
                        `Map "${mapping.from}" → "${mapping.to}"`
                      ),
                      React.createElement(
                        "div",
                        {
                          style: {
                            color: "var(--text-muted)",
                            fontSize: "12px",
                          },
                        },
                        `Mode: ${mapping.mode}`
                      )
                    ),
                    React.createElement(
                      "button",
                      {
                        onClick: () => {
                          const newMappings = customMappings.filter(
                            (_, i) => i !== index
                          );
                          setCustomMappings(newMappings);
                          this.customMappings = newMappings;
                          this.saveConfig();
                          this.aceEditors.forEach(({ editor }) =>
                            this.applyVimMappings(editor)
                          );
                          BdApi.UI.showToast("Key mapping removed", {
                            type: "success",
                          });
                        },
                        style: {
                          padding: "5px 10px",
                          backgroundColor: "#ed4245",
                          color: "white",
                          border: "none",
                          borderRadius: "3px",
                          cursor: "pointer",
                          fontSize: "12px",
                        },
                      },
                      "Delete"
                    )
                  )
                )
              ),
            React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  padding: "15px",
                  backgroundColor: "var(--background-secondary)",
                  borderRadius: "3px",
                },
              },
              React.createElement(
                "div",
                {
                  style: { fontWeight: "500", color: "var(--header-primary)" },
                },
                "Add New Vim Mapping"
              ),
              React.createElement(
                "div",
                { style: { display: "flex", gap: "10px", flexWrap: "wrap" } },
                React.createElement(
                  "div",
                  { style: { flex: "1 1 120px" } },
                  React.createElement(
                    "label",
                    {
                      style: {
                        display: "block",
                        color: "var(--text-muted)",
                        fontSize: "12px",
                        marginBottom: "5px",
                      },
                    },
                    "From (e.g., j, <C-e>)"
                  ),
                  TextInput
                    ? React.createElement(TextInput, {
                        value: newMappingKeys,
                        placeholder: "j",
                        onChange: (v) => setNewMappingKeys(v),
                      })
                    : React.createElement("input", {
                        type: "text",
                        value: newMappingKeys,
                        onChange: (e) => setNewMappingKeys(e.target.value),
                        placeholder: "j",
                        className: "inputDefault-3FGxgL input-2g-os5",
                        style: { width: "100%" },
                      })
                ),
                React.createElement(
                  "div",
                  { style: { flex: "1 1 120px" } },
                  React.createElement(
                    "label",
                    {
                      style: {
                        display: "block",
                        color: "var(--text-muted)",
                        fontSize: "12px",
                        marginBottom: "5px",
                      },
                    },
                    "To (e.g., gj, <Right>)"
                  ),
                  TextInput
                    ? React.createElement(TextInput, {
                        value: newMappingAction,
                        placeholder: "gj",
                        onChange: (v) => setNewMappingAction(v),
                      })
                    : React.createElement("input", {
                        type: "text",
                        value: newMappingAction,
                        onChange: (e) => setNewMappingAction(e.target.value),
                        placeholder: "gj",
                        className: "inputDefault-3FGxgL input-2g-os5",
                        style: { width: "100%" },
                      })
                ),
                React.createElement(
                  "div",
                  { style: { flex: "1 1 100px" } },
                  React.createElement(
                    "label",
                    {
                      style: {
                        display: "block",
                        color: "var(--text-muted)",
                        fontSize: "12px",
                        marginBottom: "5px",
                      },
                    },
                    "Mode"
                  ),
                  React.createElement(
                    "select",
                    {
                      value: newMappingTimeout,
                      onChange: (e) => setNewMappingTimeout(e.target.value),
                      className: "inputDefault-3FGxgL input-2g-os5",
                      style: { width: "100%" },
                    },
                    React.createElement(
                      "option",
                      { value: "normal" },
                      "normal"
                    ),
                    React.createElement(
                      "option",
                      { value: "insert" },
                      "insert"
                    ),
                    React.createElement("option", { value: "visual" }, "visual")
                  )
                )
              ),
              React.createElement(
                "button",
                {
                  onClick: () => {
                    if (!newMappingKeys.trim() || !newMappingAction.trim()) {
                      BdApi.UI.showToast(
                        "Please enter both 'from' and 'to' keys",
                        { type: "error" }
                      );
                      return;
                    }
                    const newMapping = {
                      from: newMappingKeys.trim(),
                      to: newMappingAction.trim(),
                      mode: newMappingTimeout,
                    };
                    const newMappings = [...customMappings, newMapping];
                    setCustomMappings(newMappings);
                    this.customMappings = newMappings;
                    this.saveConfig();
                    this.aceEditors.forEach(({ editor }) =>
                      this.applyVimMappings(editor)
                    );
                    setNewMappingKeys("");
                    setNewMappingAction("");
                    setNewMappingTimeout("normal");
                    BdApi.UI.showToast("Vim mapping added", {
                      type: "success",
                    });
                  },
                  style: {
                    padding: "8px 16px",
                    backgroundColor: "#3ba55d",
                    color: "white",
                    border: "none",
                    borderRadius: "3px",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: "500",
                  },
                },
                "Add Vim Mapping"
              )
            )
          ),
          React.createElement(
            "div",
            {
              style: {
                marginTop: "20px",
                paddingTop: "20px",
                borderTop: "1px solid var(--background-modifier-accent)",
                display: "flex",
                gap: "10px",
                justifyContent: "flex-end",
              },
            },
            React.createElement(
              "button",
              {
                onClick: () => {
                  setConfig(this.defaultConfig);
                  this.config = this.defaultConfig;
                  this.saveConfig();
                  this.addStyles();
                  this.aceEditors.forEach((editorData, originalInput) => {
                    this.applyEditorSettings(editorData.editor, originalInput);
                    editorData.editor.resize(true);
                  });
                  BdApi.UI.showToast("Settings reset to defaults", {
                    type: "success",
                  });
                },
                className: "bd-button bd-button-filled",
                style: {
                  backgroundColor: "#ed4245",
                  color: "white",
                  padding: "8px 16px",
                  borderRadius: "3px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                },
              },
              "Reset to Defaults"
            )
          )
        );
      };
    } catch (error) {
      console.error("[VimMotions] Error in getSettingsPanel:", error);
      return () =>
        React.createElement(
          "div",
          { style: { padding: "20px", color: "var(--text-normal)" } },
          React.createElement("h3", null, "Error loading settings"),
          React.createElement("p", null, error.toString())
        );
    }
  }

  // Styles (unchanged)
  addStyles() {
    const fontSize = this.config?.fontSize || this.defaultConfig.fontSize;
    const fontFamily = this.config?.fontFamily || this.defaultConfig.fontFamily;
    const fontColor = this.config?.fontColor || this.defaultConfig.fontColor;
    const backgroundColor =
      this.config?.backgroundColor || this.defaultConfig.backgroundColor;
    const cursorColor =
      this.config?.cursorColor || this.defaultConfig.cursorColor;

    const hexToRgba = (hex, alpha) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };
    const cursorColorTransparent = hexToRgba(cursorColor, 0.8);

    BdApi.DOM.removeStyle("VimMotions");

    BdApi.DOM.addStyle(
      "VimMotions",
      `
      .vim-ace-wrapper { position: relative; width: 100%; min-height: 44px; overflow: visible; }
      .vim-ace-editor { width: 100% !important; min-height: 44px; position: relative; }
      .vim-ace-editor .ace_editor { font-family: '${fontFamily}', monospace !important; font-size: ${fontSize}px !important; color: ${fontColor} !important; background-color: ${backgroundColor} !important; width: 100% !important; }
      .vim-ace-editor .ace_scroller { overflow-y: auto !important; overflow-x: hidden !important; }
      .vim-ace-editor .ace_scrollbar, .vim-ace-editor .ace_scrollbar-v, .vim-ace-editor .ace_scrollbar-h { display: none !important; }
      .vim-ace-editor .ace_scroller::-webkit-scrollbar { display: none; width: 0; height: 0; }
      .vim-ace-editor .ace_editor, .vim-ace-editor .ace_scroller, .vim-ace-editor .ace_content { background: ${backgroundColor} !important; background-color: ${backgroundColor} !important; }
      .vim-ace-editor .ace_content { transform: translateY(10px) !important; }
      .vim-ace-editor .ace_line, .vim-ace-editor .ace_line > *, .vim-ace-editor .ace_line span { color: ${fontColor} !important; }
      .vim-ace-editor .ace_text-layer .ace_line, .vim-ace-editor .ace_text-layer .ace_line span { color: ${fontColor} !important; }
      .vim-ace-editor .ace_cursor-layer .ace_cursor { border-color: ${cursorColor}; }
      .vim-ace-editor.vim-insert-mode .ace_cursor-layer .ace_cursor { border-left-width: 2px; border-left-color: ${cursorColor}; }
      .vim-ace-editor.vim-normal-mode .ace_cursor-layer .ace_cursor, .vim-ace-editor.vim-visual-mode .ace_cursor-layer .ace_cursor { background-color: ${cursorColorTransparent} !important; }
      .vim-ace-editor.vim-normal-mode .ace_cursor-layer .ace_cursor.ace_overwrite-cursors, .vim-ace-editor.vim-visual-mode .ace_cursor-layer .ace_cursor.ace_overwrite-cursors { color: ${fontColor} !important; opacity: 1 !important; }
      .vim-ace-editor.vim-normal-mode .ace_text-layer, .vim-ace-editor.vim-visual-mode .ace_text-layer { z-index: 2 !important; }
      .vim-ace-editor.vim-normal-mode .ace_cursor-layer, .vim-ace-editor.vim-visual-mode .ace_cursor-layer { z-index: 1 !important; opacity: 1; }
      .vim-ace-editor .ace_gutter { background: ${backgroundColor} !important; color: ${fontColor} !important; }
      .vim-hidden-input { display: none !important; }
    `
    );
  }

  // Input Observation & Ace Editor Management

  startObserving() {
    this.findAndAttachToInputs();

    this.observer = new MutationObserver(() => {
      this.findAndAttachToInputs();
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  findAndAttachToInputs(root = document) {
    const selectors = [
      '[data-slate-editor="true"]',
      'div[role="textbox"][contenteditable="true"]',
    ];

    selectors.forEach((selector) => {
      const inputs = root.querySelectorAll
        ? root.querySelectorAll(selector)
        : [];
      inputs.forEach((input) => {
        if (!this.activeInputs.has(input) && this.shouldAttachToInput(input)) {
          this.attachAceEditor(input);
        }
      });
    });
  }

  shouldAttachToInput(input) {
    const parent =
      input.closest('[class*="channelTextArea"]') ||
      input.closest('[class*="chatContent"]');
    return parent !== null;
  }

  getCurrentChannelId() {
    const channelId = this.dcModules.SelectedChannelStore.getChannelId();
    if (!channelId) {
      this.log("No channel ID found from SelectedChannelStore", "error");
    }
    return channelId;
  }

  // Listen for channel changes and save draft before switching
  setupChannelChangeListener() {
    // Don't subscribe if already subscribed
    if (this.channelChangeUnsubscribe) {
      this.log("Channel change listener already set up, skipping");
      return;
    }

    if (!this.dcModules.SelectedChannelStore) {
      this.log("SelectedChannelStore not found, cannot setup listener", "warn");
      return;
    }

    let previousChannelId = this.dcModules.SelectedChannelStore.getChannelId();

    // Subscribe to channel changes
    const handleChannelChange = () => {
      const newChannelId = this.dcModules.SelectedChannelStore.getChannelId();

      if (previousChannelId && previousChannelId !== newChannelId) {
        // Save draft for the OLD channel before switching
        this.saveCurrentChannelDraft(previousChannelId);
      }

      previousChannelId = newChannelId;
    };

    // Use Flux dispatcher to listen for channel changes
    try {
      const Dispatcher = BdApi.Webpack.getModule(
        (m) => m.dispatch && m.subscribe
      );
      if (Dispatcher) {
        this.channelChangeUnsubscribe = Dispatcher.subscribe(
          "CHANNEL_SELECT",
          handleChannelChange
        );
        this.log("Subscribed to channel change events");
      } else {
        this.log("Flux Dispatcher not found", "warn");
      }
    } catch (e) {
      this.log(
        `Failed to setup channel change listener: ${e.message}`,
        "error"
      );
    }
  }

  // Save draft for current channel from Ace editor
  saveCurrentChannelDraft(channelId) {
    try {
      // First, try to get content from cache (updated as we type)
      let content = this.draftCache.get(channelId) || "";

      // If not in cache, try to get from active editor
      if (!content) {
        for (const [originalInput, editorData] of this.aceEditors.entries()) {
          const container = originalInput.closest('[class*="channelTextArea"]');
          const isMainChatInput =
            container && !this.isEditMode(originalInput) && editorData.editor;

          if (isMainChatInput) {
            content = editorData.editor.getValue();
            break;
          }
        }
      }

      // Clear empty drafts
      if (!content.trim()) {
        this.dcModules.DraftActions.clearDraft(channelId, 0);
        this.draftCache.delete(channelId);
        return;
      }

      // Save non-empty draft
      this.dcModules.DraftActions.saveDraft(channelId, content, 0);
      this.log(`Saved draft for ${channelId}: "${content}"`);
    } catch (e) {
      this.log(`Error saving draft on channel change: ${e.message}`, "error");
    }
  }

  // Listen for draft changes from Discord (e.g., emoji picker)
  setupDraftChangeListener() {
    // Don't subscribe if already subscribed
    if (this.draftChangeUnsubscribe) {
      this.log("Draft change listener already set up, skipping");
      return;
    }

    if (!this.dcModules.DraftStore) {
      this.log("DraftStore not found, cannot setup draft listener", "warn");
      return;
    }

    try {
      const Dispatcher = BdApi.Webpack.getModule(
        (m) => m.dispatch && m.subscribe
      );

      if (!Dispatcher) {
        this.log("Flux Dispatcher not found for draft listener", "warn");
        return;
      }

      const handleDraftChange = (data) => {
        try {
          const channelId = this.getCurrentChannelId();
          if (!channelId || data.channelId !== channelId) return;

          // Get the draft content from Discord
          const draftContent = this.dcModules.DraftStore.getDraft(channelId, 0);
          if (!draftContent || !draftContent.trim()) return;

          // Check if we've already processed this exact draft content
          const lastProcessed = this.lastProcessedDraft.get(channelId) || "";
          if (lastProcessed === draftContent) {
            this.log(`Already processed this draft content, skipping`);
            return;
          }

          // Find the active Ace editor for the current channel
          let activeEditor = null;
          for (const [originalInput, editorData] of this.aceEditors.entries()) {
            const container = originalInput.closest(
              '[class*="channelTextArea"]'
            );
            const isMainChatInput =
              container && !this.isEditMode(originalInput) && editorData.editor;

            if (isMainChatInput) {
              activeEditor = editorData.editor;
              break;
            }
          }

          if (!activeEditor) return;

          // Get current editor content
          const editorContent = activeEditor.getValue();

          // Check if the draft content is already in the editor (avoid duplicates)
          if (editorContent.includes(draftContent.trim())) {
            // Draft content is already in editor, just clear the draft
            this.dcModules.DraftActions.clearDraft(channelId, 0);
            this.lastProcessedDraft.set(channelId, draftContent);
            this.log(`Draft content already in editor, cleared draft`);
            return;
          }

          // Check if editor is empty AND we have a cached draft for this channel
          // This indicates we're in the middle of a channel switch/load, so skip
          const hasCachedDraft =
            this.draftCache.has(channelId) &&
            this.draftCache.get(channelId).trim();
          if (
            (!editorContent || editorContent.trim() === "") &&
            hasCachedDraft
          ) {
            this.log(
              `Editor is empty but we have cached draft, skipping to avoid conflicts during channel load`
            );
            return;
          }

          // Extract only the NEW content (the emoji that was just added)
          // Calculate the difference between current draft and last processed draft
          let newContent = draftContent.trim();

          if (lastProcessed && draftContent.startsWith(lastProcessed)) {
            // Draft has accumulated - extract only the new part
            newContent = draftContent.substring(lastProcessed.length).trim();
            this.log(
              `Extracted new emoji from accumulated draft: "${newContent}" (was: "${lastProcessed}", now: "${draftContent}")`
            );
          } else if (lastProcessed) {
            // Draft was replaced entirely - use the whole thing
            this.log(`Draft was replaced, using full content: "${newContent}"`);
          } else {
            // First emoji or no previous draft
            this.log(`First emoji or no previous draft: "${newContent}"`);
          }

          // Skip if no new content to insert
          if (!newContent) {
            this.log(`No new content to insert, skipping`);
            this.lastProcessedDraft.set(channelId, draftContent);
            return;
          }

          // Insert the emoji at cursor position
          const cursor = activeEditor.getCursorPosition();
          activeEditor.session.insert(cursor, newContent);

          this.log(`Inserted emoji from draft: "${newContent}"`);

          // Mark this draft as processed BEFORE clearing (to prevent re-processing)
          this.lastProcessedDraft.set(channelId, draftContent);

          // Clear the draft from DraftStore
          this.dcModules.DraftActions.clearDraft(channelId, 0);

          // Update our cache to match the editor
          this.draftCache.set(channelId, activeEditor.getValue());

          // Re-focus the editor after emoji insertion
          setTimeout(() => {
            try {
              // Find the editor data to get the textarea
              for (const [input, editorData] of this.aceEditors.entries()) {
                if (editorData.editor === activeEditor) {
                  activeEditor.focus();
                  if (editorData.textarea) {
                    editorData.textarea.focus();
                  }
                  this.log("Re-focused editor after emoji insertion");
                  break;
                }
              }
            } catch (e) {
              this.log(`Error re-focusing editor: ${e.message}`, "warn");
            }
          }, 50);
        } catch (e) {
          this.log(`Error handling draft change: ${e.message}`, "warn");
        }
      };

      // Subscribe to draft changes
      this.draftChangeUnsubscribe = Dispatcher.subscribe(
        "DRAFT_CHANGE",
        handleDraftChange
      );

      this.log("Subscribed to draft change events");
    } catch (e) {
      this.log(`Failed to setup draft change listener: ${e.message}`, "error");
    }
  }

  attachAceEditor(originalInput) {
    if (!this.aceLoaded || !window.ace) {
      this.log("Ace Editor not loaded", "error");
      return;
    }

    try {
      const { editor, editorDiv } = this.createEditor(originalInput);

      this.loadInitialContent(editor, originalInput);

      const isEditMode = this.isEditMode(originalInput);

      this.setupVimMode(editor, editorDiv, originalInput);

      // Ensure editor is properly focused and ready for input
      // This is especially important when switching from edit mode back to main chatbox
      // We need to wait longer to ensure vimMode is initialized (setupVimMode uses 50ms + 100ms = 150ms total)
      setTimeout(() => {
        const editorData = this.aceEditors.get(originalInput);
        // this.log(
        //   `Editor data exists: ${!!editorData}, has vimMode: ${!!editorData?.vimMode}`
        // );

        if (editorData && editorData.editor && editorData.textarea) {
          try {
            editorData.editor.focus();
            editorData.textarea.focus();
            // Force editor to recognize it's ready for input
            editorData.editor.renderer.updateFull(true);

            // Force insert mode for main chatbox (not edit mode)
            if (!isEditMode) {
              if (editorData.vimMode) {
                const vim = editorData.vimMode.constructor.Vim;
                if (vim) {
                  vim.handleKey(editorData.vimMode, "i", null);
                } else {
                  this.log("Vim constructor not found", "warn");
                }
              } else {
                this.log("vimMode not available yet in editorData", "warn");
              }
            }
          } catch (e) {
            this.log(
              `Error focusing editor after attach: ${e.message}`,
              "warn"
            );
          }
        } else {
          this.log("Editor data not found or incomplete", "warn");
        }
      }, 200);
    } catch (e) {
      this.log(`Failed to attach Ace editor: ${e.message}`, "error");
    }
  }

  createEditor(originalInput) {
    const wrapper = document.createElement("div");
    wrapper.className = "vim-ace-wrapper";

    const editorDiv = document.createElement("div");
    editorDiv.className = "vim-ace-editor";
    wrapper.appendChild(editorDiv);

    // Insert wrapper and hide original input
    originalInput.parentNode.insertBefore(wrapper, originalInput);
    originalInput.classList.add("vim-hidden-input");

    // Initialize Ace
    const editor = window.ace.edit(editorDiv);
    this.applyEditorSettings(editor, originalInput);

    // Placeholder from Discord DOM
    const placeholderText = this.getPlaceholderText(originalInput);
    if (placeholderText) this.setPlaceholder(editor, placeholderText);

    // Get Ace's hidden textarea (so we can focus/remove listeners reliably)
    const textarea =
      editor.textInput && typeof editor.textInput.getElement === "function"
        ? editor.textInput.getElement()
        : null;
    if (textarea) {
      textarea.tabIndex = 0;
      textarea.style.cssText =
        "opacity:0;position:absolute;z-index:0;height:100%;width:100%;left:0;top:0;outline:none";
      textarea.removeAttribute("readonly");
      textarea.removeAttribute("disabled");
    }

    // Store references for cleanup and later focusing
    this.aceEditors.set(originalInput, {
      editor,
      wrapper,
      textarea,
      editorDiv,
      // vimMode will be attached later in setupVimMode
      vimMode: null,
    });
    this.activeInputs.add(originalInput);

    return { editor, wrapper, editorDiv };
  }

  isEditMode(originalInput) {
    const container = originalInput.closest('[class*="channelTextArea"]');
    if (!container) return false;
    const parent = container.parentElement;
    if (!parent) return false;
    const operations = parent.querySelector('[class*="operations"]');
    return operations !== null;
  }

  loadInitialContent(editor, originalInput) {
    // Load existing content - supports both edit mode and draft store
    const isEditMode = this.isEditMode(originalInput);

    // Extract lines correctly from Discord’s editable DOM
    let existingContent = "";

    if (isEditMode) {
      // Extract lines from Discord's editable DOM for edit mode
      existingContent = this.extractEditModeText(originalInput);

      if (!existingContent || !existingContent.trim()) {
        this.log("No existing content found for edit mode.");
        return;
      }

      editor.setValue(existingContent, -1);
      editor.navigateFileEnd();
      this.log(
        `Loaded existing content from edit mode with newlines preserved:\n${existingContent}`
      );
      return;
    }

    // For normal chat input, check cache first, then DraftStore
    try {
      const channelId = this.getCurrentChannelId();
      if (!channelId) return;

      // Check cache first
      const cachedDraft = this.draftCache.get(channelId);
      if (cachedDraft && cachedDraft.trim()) {
        editor.setValue(cachedDraft, -1);
        editor.navigateFileEnd();
        this.log(
          `Loaded draft from cache for channel ${channelId}: "${cachedDraft}"`
        );
        return;
      }

      // Check DraftStore
      if (this.dcModules.DraftStore) {
        const draft = this.dcModules.DraftStore.getDraft(channelId, 0);
        if (draft && draft.trim()) {
          editor.setValue(draft, -1);
          editor.navigateFileEnd();
          this.draftCache.set(channelId, draft);
          this.log(
            `Loaded draft from DraftStore for channel ${channelId}: "${draft}"`
          );
          return;
        }
      }
    } catch (e) {
      this.log(`Failed to load draft: ${e.message}`, "warn");
    }

    // Fallback to input content
    existingContent =
      originalInput.innerText || originalInput.textContent || "";
    if (existingContent && existingContent.trim()) {
      editor.setValue(existingContent, -1);
      editor.navigateFileEnd();
      this.log(
        `Loaded existing content from main chatbox: "${existingContent}"`
      );
    }
  }

  extractEditModeText(originalInput) {
    try {
      const lineNodes = originalInput.querySelectorAll(
        "div[data-slate-node='element']"
      );

      if (lineNodes.length > 0) {
        return Array.from(lineNodes)
          .map((div) => {
            const text = div.innerText || div.textContent || "";
            // Remove zero-width characters (BOM, ZWSP, ZWNJ, ZWJ)
            return text.replace(/[\uFEFF\u200B\u200C\u200D]/g, "");
          })
          .join("\n");
      }
    } catch (e) {
      // Fall through to fallback
    }

    // Fallback
    const content = originalInput.innerText || originalInput.textContent || "";
    return content.replace(/[\uFEFF\u200B\u200C\u200D]/g, "");
  }

  setupVimMode(editor, editorDiv, originalInput) {
    let vimMode = null;

    const textarea = editor.textInput.getElement();
    const keySequences = this.initializeKeySequences();

    // Shift+Enter for new line
    editor.commands.addCommand({
      name: "newLine",
      bindKey: { win: "Shift-Enter", mac: "Shift-Enter" },
      exec: (ed) => ed.insert("\n"),
    });

    // Setup keyboard handling and store listener so we can remove it on destroy
    const keydownListener = (e) =>
      this.handleKeydown(e, editor, originalInput, vimMode, keySequences);
    textarea.addEventListener("keydown", keydownListener);

    // Enable Vim keybindings after a short delay
    setTimeout(() => {
      this.log("Setting Vim keyboard handler...");
      editor.setKeyboardHandler("ace/keyboard/vim");
      vimMode = editor.state.cm;

      if (vimMode) {
        this.setupVimModeHandlers(vimMode, editor, textarea);
        this.applyVimMappings(editor);
      }

      const clickListener = () =>
        this.handleEditorClick(editor, textarea, vimMode);
      editorDiv.addEventListener("click", clickListener);

      // Add focus listener to detect when returning to this editor
      const focusListener = () => {
        if (this.isEditMode(originalInput)) return;

        if (this.currentMode === "insert") return;

        const editorData = this.aceEditors.get(originalInput);
        if (!editorData || !editorData.vimMode) return;

        const currentVimMode = editorData.vimMode;
        const vim = currentVimMode.constructor?.Vim;
        if (!vim) return;

        try {
          this.justEnteredInsertMode = false;

          // Update CSS classes immediately
          const editorDiv = editor.container.closest(".vim-ace-editor");
          if (editorDiv) {
            editorDiv.classList.remove("vim-normal-mode", "vim-visual-mode");
            editorDiv.classList.add("vim-insert-mode");
          }

          // Try direct Vim state change first
          if (currentVimMode.state?.vim) {
            currentVimMode.state.vim.insertMode = true;
            this.currentMode = "insert";

            setTimeout(() => (this.justEnteredInsertMode = false), 60);
            return;
          }

          // Fallback: simulate pressing "i"
          vim.handleKey(currentVimMode, "i", null);
          this.currentMode = "insert"; // Ensure mode is set even with fallback
          setTimeout(() => (this.justEnteredInsertMode = false), 60);
        } catch (e) {
          // ignore all errors silently
        }
      };

      editorDiv.addEventListener("focus", focusListener, true);
      editorDiv.addEventListener("click", focusListener);
      textarea.addEventListener("focus", focusListener);

      // store listeners and vimMode for cleanup and later access
      const prev = this.aceEditors.get(originalInput) || {};
      this.aceEditors.set(originalInput, {
        ...prev,
        keydownListener,
        clickListener,
        focusListener,
        editorDiv,
        vimMode, // Store vimMode so we can access it later
      });
    }, 50);

    return vimMode;
  }

  applyVimMappings(editor) {
    if (!editor || !editor.state || !editor.state.cm) {
      this.log("Cannot apply Vim mappings: Vim mode not initialized", "warn");
      return;
    }

    try {
      window.ace.config.loadModule("ace/keyboard/vim", (vimModule) => {
        const Vim = vimModule.Vim;
        if (!Vim) {
          this.log("Vim module not found", "error");
          return;
        }

        const singleKeyMappings = [];
        const sequenceMappings = [];

        this.customMappings.forEach((mapping) => {
          if (!mapping || !mapping.from) return;
          if (mapping.from.length > 1 && !mapping.from.startsWith("<"))
            sequenceMappings.push(mapping);
          else singleKeyMappings.push(mapping);
        });

        singleKeyMappings.forEach((mapping) => {
          try {
            if (typeof Vim.map === "function") {
              Vim.map(mapping.from, mapping.to, mapping.mode);
              this.log(
                `Applied Vim mapping: ${mapping.from} → ${mapping.to} (${mapping.mode})`
              );
            } else {
              this.log(
                `Vim.map not available; cannot apply mapping ${mapping.from}`,
                "warn"
              );
            }
          } catch (e) {
            this.log(
              `Error applying mapping ${mapping.from}: ${e.message}`,
              "error"
            );
          }
        });

        if (sequenceMappings.length > 0) {
          this.log(
            `${sequenceMappings.length} sequence mappings require key sequence detection`
          );
        }
      });
    } catch (e) {
      this.log(`Error loading Vim module: ${e.message}`, "error");
    }
  }

  initializeKeySequences() {
    const sequences = new Map();
    this.customMappings.forEach((mapping) => {
      if (mapping.from.length > 1 && !mapping.from.startsWith("<")) {
        sequences.set(mapping.from, {
          buffer: [],
          lastTime: 0,
          timeout: 1000,
          action: mapping.to,
          mode: mapping.mode,
        });
      }
    });
    return sequences;
  }

  handleKeydown(e, editor, originalInput, vimMode, keySequences) {
    // Guard: editor might have been destroyed
    if (!editor || editor._destroyed) return;

    if (e.isComposing || e.key === "Process") return;

    if (e.key === "Enter" && !e.shiftKey) {
      this.handleEnterKey(e, editor, originalInput, vimMode);
      return;
    }

    if (this.currentMode === "insert" && e.key.length === 1 && keySequences) {
      if (this.handleKeySequence(e, editor, vimMode, keySequences)) return;
    }

    const vimModeChangeKeys = [
      "i",
      "a",
      "I",
      "A",
      "o",
      "O",
      "s",
      "S",
      "c",
      "C",
      "r",
      "R",
    ];
    const shouldSkipInsertion =
      this.justEnteredInsertMode && vimModeChangeKeys.includes(e.key);

    if (
      !shouldSkipInsertion &&
      this.currentMode === "insert" &&
      e.key.length === 1 &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey
    ) {
      e.preventDefault();
      e.stopPropagation();
      const insertSuccess = editor.insert(e.key);
      this.log(
        `Manual insert (insert mode): ${e.key}, Edit mode: ${this.isEditMode(
          originalInput
        )}, Insert success: ${insertSuccess !== false}`
      );
    } else {
      this.log(`Vim handling (${this.currentMode} mode): ${e.key}`);
    }
  }

  handleKeySequence(e, editor, vimMode, keySequences) {
    const now = Date.now();
    let matchedSequence = null;

    for (const [keys, sequence] of keySequences.entries()) {
      if (sequence.mode !== this.currentMode) continue;
      const timeDiff = now - sequence.lastTime;
      if (timeDiff >= sequence.timeout) sequence.buffer = [];
      sequence.buffer.push(e.key);
      sequence.lastTime = now;
      const bufferStr = sequence.buffer.join("");
      if (bufferStr === keys) {
        matchedSequence = { keys, sequence };
        break;
      }
      if (!keys.startsWith(bufferStr)) {
        sequence.buffer = [e.key];
        if (!keys.startsWith(e.key)) sequence.buffer = [];
      }
    }

    if (matchedSequence) {
      const { keys, sequence } = matchedSequence;
      e.preventDefault();
      e.stopPropagation();
      const pos = editor.getCursorPosition();
      const charsToRemove = keys.length - 1;
      if (charsToRemove > 0) {
        const startCol = Math.max(0, pos.column - charsToRemove);
        editor.session.remove({
          start: { row: pos.row, column: startCol },
          end: pos,
        });
      }

      if (sequence.action === "<Esc>" && vimMode) {
        const vim = vimMode.constructor.Vim;
        if (vim) {
          vim.handleKey(vimMode, "<Esc>", null);
          this.log(`Sequence "${keys}" → exit insert mode`);
        }
      }

      for (const seq of keySequences.values()) {
        seq.buffer = [];
        seq.lastTime = 0;
      }
      return true;
    }

    for (const [keys, sequence] of keySequences.entries()) {
      if (sequence.mode !== this.currentMode) continue;
      const bufferStr = sequence.buffer.join("");
      if (keys.startsWith(bufferStr) && bufferStr.length > 0) return false;
    }

    return false;
  }

  handleEnterKey(e, editor, originalInput, vimMode) {
    const isEditMode = this.isEditMode(originalInput);

    const shouldSendInInsert =
      this.config.sendInInsertMode && this.currentMode === "insert";
    const shouldSendInNormal =
      this.config.sendInNormalMode && this.currentMode !== "insert";

    if (shouldSendInInsert || shouldSendInNormal) {
      e.preventDefault();
      e.stopPropagation();

      const content = editor.getValue().trim();
      if (!content) {
        this.log("No content to send");
        return;
      }

      if (isEditMode) {
        this.editMessage(content, e);
        this.log(`Enter in ${this.currentMode} mode: message edited`);
      } else {
        this.sendMessage(content);
        editor.setValue("", -1);
        try {
          const vim = vimMode.constructor.Vim;
          if (vim) vim.handleKey(vimMode, "i", null);
        } catch (e) {}
        this.log(`Enter in ${this.currentMode} mode: message sent`);
      }
    } else {
      this.log(`Enter in ${this.currentMode} mode: new line`);
    }
  }

  setupVimModeHandlers(vimMode, editor, textarea) {
    if (!vimMode || !editor) return;

    vimMode.on("vim-mode-change", (data) => {
      const previousMode = this.currentMode;
      this.currentMode = data.mode;
      this.log(`Vim mode changed: ${data.mode}`);

      if (previousMode === "normal" && data.mode === "insert") {
        this.justEnteredInsertMode = true;
        setTimeout(() => {
          this.justEnteredInsertMode = false;
        }, 50);
      }

      const editorDiv = editor.container.closest(".vim-ace-editor");
      if (editorDiv) {
        editorDiv.classList.remove(
          "vim-insert-mode",
          "vim-normal-mode",
          "vim-visual-mode"
        );
        if (data.mode === "insert") editorDiv.classList.add("vim-insert-mode");
        else if (data.mode === "visual")
          editorDiv.classList.add("vim-visual-mode");
        else editorDiv.classList.add("vim-normal-mode");
      }

      if (this.onModeChange) this.onModeChange();
    });

    setTimeout(() => {
      try {
        const vim = vimMode.constructor.Vim;
        if (vim) {
          vim.handleKey(vimMode, "i", null);
          this.log("Switched to insert mode on initialization");
          editor.focus();
          textarea.focus();
          // Ensure textarea is properly set up to receive input
          if (textarea) {
            textarea.removeAttribute("readonly");
            textarea.removeAttribute("disabled");
            textarea.tabIndex = 0;
          }
          const editorDiv = editor.container.closest(".vim-ace-editor");
          if (editorDiv) editorDiv.classList.add("vim-insert-mode");
        }
      } catch (e) {
        this.log(`Error setting up initial insert mode: ${e.message}`, "warn");
      }
    }, 100);
  }

  handleEditorClick(editor, textarea, vimMode) {
    try {
      editor.focus();
      textarea.focus();
      // Ensure textarea is ready to receive input
      if (textarea) {
        textarea.removeAttribute("readonly");
        textarea.removeAttribute("disabled");
      }
      setTimeout(() => {
        if (vimMode && this.currentMode !== "insert") {
          const vim = vimMode.constructor.Vim;
          if (vim) vim.handleKey(vimMode, "i", null);
        }
      }, 10);
    } catch (e) {
      this.log(`Error handling editor click: ${e.message}`, "warn");
    }
  }

  applyEditorSettings(editor, originalInput) {
    const fontSize = this.config?.fontSize || 14;
    const fontFamily = this.config?.fontFamily || "Consolas";
    const fontColor = this.config?.fontColor || "#dcddde";
    const backgroundColor = this.config?.backgroundColor || "#2f3136";
    const highlightActiveLine = this.config?.highlightActiveLine ?? false;

    editor.setOptions({
      theme: `ace/theme/dracula`,
      fontSize: fontSize,
      fontFamily: fontFamily,
      showPrintMargin: false,
      highlightActiveLine: highlightActiveLine,
      showLineNumbers: false,
      showGutter: false,
      displayIndentGuides: false,
      wrap: true,
      indentedSoftWrap: false,
      scrollPastEnd: 0,
      hScrollBarAlwaysVisible: false,
      vScrollBarAlwaysVisible: false,
      readOnly: false,
      highlightSelectedWord: false,
      enableBasicAutocompletion: true,
      enableLiveAutocompletion: false,
      animatedScroll: false,
      useSoftTabs: true,
      tabSize: 2,
      copyWithEmptySelection: true,
    });

    editor.renderer.setShowGutter(false);
    editor.renderer.setScrollMargin(8, 8, 0, 0);

    const cursorColor = this.config?.cursorColor || "#ffffff";
    editor.renderer.$cursorLayer.config.cursorColor = cursorColor;

    setTimeout(() => {
      const editorElement = editor.container;
      if (!editorElement) return;
      editorElement.style.setProperty("--ace-background", backgroundColor);
      editorElement.style.setProperty("--ace-foreground", fontColor);
      editorElement.style.setProperty("--ace-cursor-color", cursorColor);

      const styleElement = editorElement.querySelector(".ace_editor");
      if (styleElement) {
        styleElement.style.backgroundColor = backgroundColor;
        styleElement.style.color = fontColor;
      }
      const contentElement = editorElement.querySelector(".ace_scroller");
      if (contentElement)
        contentElement.style.backgroundColor = backgroundColor;

      const textLayer = editorElement.querySelector(".ace_text-layer");
      if (textLayer) {
        textLayer.style.color = fontColor;
        const lines = textLayer.querySelectorAll(".ace_line");
        lines.forEach((line) => {
          line.style.color = fontColor;
          const spans = line.querySelectorAll("span");
          spans.forEach((span) => (span.style.color = fontColor));
        });
      }
    }, 10);

    // Cache DOM elements for better performance
    const aceContent = editor.container.querySelector(".ace_content");
    const discordTextArea = editor.container.closest('[class*="textArea"]');
    const channelTextArea = editor.container.closest(
      '[class*="channelTextArea"]'
    );

    const updateHeight = () => {
      try {
        editor.renderer.updateFull();
        const lineHeight = editor.renderer.lineHeight || 20;
        const screenRows = editor.session.getScreenLength();
        const hasMultipleLines = screenRows > 1;
        const contentHeight = screenRows * lineHeight;
        const topPadding = 10;
        const bottomPadding = hasMultipleLines ? 10 : 0;
        const totalPadding = topPadding + bottomPadding + 10;
        const minHeight = 44;
        const maxHeight = Math.floor(window.innerHeight * 0.5);
        const newHeight = Math.max(
          minHeight,
          Math.min(contentHeight + totalPadding, maxHeight)
        );
        editor.container.style.height = `${newHeight}px`;
        if (aceContent)
          aceContent.style.paddingBottom = hasMultipleLines ? "10px" : "0px";
        if (discordTextArea) discordTextArea.style.height = `${newHeight}px`;
        if (channelTextArea) channelTextArea.style.minHeight = `${newHeight}px`;
        editor.resize(true);
      } catch (e) {}
    };

    // Optimize: Cache the isEditMode result and channelId since they don't change per editor instance
    const cachedIsEditMode = this.isEditMode(originalInput);
    const cachedChannelId = !cachedIsEditMode
      ? this.getCurrentChannelId()
      : null;

    editor.session.on("change", () => {
      setTimeout(updateHeight, 10);

      // Update draft cache for current channel (only for main chat input, not edit mode)
      if (cachedChannelId && !cachedIsEditMode) {
        try {
          this.draftCache.set(cachedChannelId, editor.getValue());
        } catch (e) {
          // Silent fail - cache update is not critical
        }
      }
    });
    setTimeout(updateHeight, 100);
  }

  sendMessage(content) {
    try {
      // Validate content
      if (!content || !content.trim()) {
        this.log("No content to send");
        return;
      }

      const channelId = this.getCurrentChannelId();
      this.log(
        `Attempting to send message to channel ${channelId}: "${content}"`
      );

      // Send message
      this.dcModules.MessageActions.sendMessage(
        channelId,
        {
          content: content.trim(),
          invalidEmojis: [],
          validNonShortcutEmojis: [],
        },
        undefined,
        {}
      );
      this.log("Message sent successfully");

      // Clear draft and cache
      if (!channelId || !this.dcModules.DraftActions) return;

      try {
        this.dcModules.DraftActions.clearDraft(channelId, 0);
        this.draftCache.delete(channelId);
        this.lastProcessedDraft.delete(channelId);
        this.log(`Cleared draft for channel ${channelId}`);
      } catch (e) {
        this.log(`Failed to clear draft: ${e.message}`, "warn");
      }
    } catch (error) {
      this.log(`Error sending message: ${error.message}`, "error");
      console.error("[VimMotions] Full error:", error);
    }
  }

  editMessage(content, e) {
    try {
      // Validate and normalize content
      if (typeof content !== "string") {
        this.log("editMessage called without valid string content", "warn");
        return;
      }

      // Normalize line endings and remove zero-width characters
      content = content.replace(/\r\n/g, "\n");
      content = content.replace(/[\uFEFF\u200B\u200C\u200D]/g, "");

      // Find message element
      const messageDiv = e?.target?.closest
        ? e.target.closest("li > [class^=message]")
        : null;

      if (!messageDiv) {
        this.log("Cannot find message element", "error");
        return;
      }

      // Get React instance
      const instance = BdApi.ReactUtils.getInternalInstance(messageDiv);
      if (!instance) {
        this.log("Cannot find React instance for message", "error");
        return;
      }

      // Find message data in React tree
      const walkable = ["child", "memoizedProps", "sibling"];
      const messageObj =
        BdApi.Utils.findInTree(instance, (m) => m?.baseMessage, { walkable })
          ?.baseMessage ??
        BdApi.Utils.findInTree(instance, (m) => m?.message, { walkable })
          ?.message;

      if (!messageObj) {
        this.log("Cannot find message data in React tree", "error");
        return;
      }

      // Validate message and channel IDs
      const messageId = messageObj.id;
      const channelId = messageObj.channel_id;

      if (!messageId || !channelId) {
        this.log("Cannot determine message or channel ID", "error");
        return;
      }

      // Validate MessageStore
      if (!this.dcModules.MessageStore?.editMessage) {
        this.log("Cannot find MessageStore.editMessage", "error");
        return;
      }

      // Send edited message
      this.log(
        `Editing message ${messageId} in channel ${channelId} with content:\n${content}`
      );
      this.dcModules.MessageStore.editMessage(channelId, messageId, {
        content,
      });
    } catch (err) {
      this.log(`Failed to edit message: ${err?.message || err}`, "error");
    }
  }

  destroyAceEditor(originalInput) {
    const editorData = this.aceEditors.get(originalInput);
    if (!editorData) return;

    try {
      const {
        editor,
        wrapper,
        keydownListener,
        clickListener,
        focusListener,
        editorDiv,
        textarea,
      } = editorData;

      // Remove event listeners
      try {
        const ta =
          textarea ||
          (editor &&
            editor.textInput &&
            editor.textInput.getElement &&
            editor.textInput.getElement());
        if (ta && keydownListener)
          ta.removeEventListener("keydown", keydownListener);
        if (editorDiv && clickListener)
          editorDiv.removeEventListener("click", clickListener);
        if (editorDiv && focusListener) {
          editorDiv.removeEventListener("focus", focusListener, true);
          editorDiv.removeEventListener("click", focusListener);
        }
        if (ta && focusListener) ta.removeEventListener("focus", focusListener);
      } catch (err) {}

      // Destroy Ace editor safely
      try {
        if (editor && typeof editor.destroy === "function") editor.destroy();
        else if (editor && typeof editor.deactivate === "function")
          editor.deactivate();
      } catch (e) {
        this.log(`Error destroying editor: ${e?.message || e}`, "warn");
      }

      if (wrapper && wrapper.parentNode)
        wrapper.parentNode.removeChild(wrapper);
      if (originalInput && originalInput.classList)
        originalInput.classList.remove("vim-hidden-input");

      // try to focus the original native input as a last-ditch fallback
      try {
        if (originalInput && typeof originalInput.focus === "function")
          originalInput.focus();
      } catch (e) {}
    } finally {
      this.aceEditors.delete(originalInput);
      this.activeInputs.delete(originalInput);
    }
  }

  getPlaceholderText(originalInput) {
    const container = originalInput.closest('[class*="channelTextArea"]');
    if (container) {
      const placeholder = container.querySelector('[class*="placeholder"]');
      if (placeholder) return placeholder.textContent || placeholder.innerText;
    }
    return "Message #channel";
  }

  setPlaceholder(editor, placeholderText) {
    const editorDiv = editor.container;
    const placeholderDiv = document.createElement("div");
    placeholderDiv.className = "ace-placeholder";
    placeholderDiv.textContent = placeholderText;
    placeholderDiv.style.cssText = `
      position: absolute;
      top: 18px;
      left: 4px;
      color: var(--text-muted, #72767d);
      pointer-events: none;
      z-index: 1;
      font-family: ${this.config?.fontFamily || "Consolas"}, monospace;
      font-size: ${this.config?.fontSize || 16}px;
    `;

    editorDiv.appendChild(placeholderDiv);

    const updatePlaceholder = () => {
      const isEmpty = editor.getValue().trim() === "";
      placeholderDiv.style.display = isEmpty ? "block" : "none";
    };

    updatePlaceholder();
    editor.session.on("change", updatePlaceholder);
  }

  log(message, type = "info") {
    console.log(`[VimMotions] ${message}`);
    if (this.config?.debugMode) {
      try {
        BdApi.UI.showToast(`[VimMotions] ${message}`, { type });
      } catch (e) {}
    }
  }
};
