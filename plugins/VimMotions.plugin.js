/**
 * @name VimMotions
 * @author github.com/thieleju
 * @description Vim motions for Discord using Ace Editor's Vim mode
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
    this.defaultConfig = {
      debugMode: false,
      fontSize: 16,
      fontFamily: "Consolas",
      fontColor: "#e3e3e3", // Discord's default text color
      backgroundColor: "#222327", // Discord's input background
      cursorColor: "#a52327",
      highlightActiveLine: false, // Highlight the current line
      sendInInsertMode: false, // Send message with Enter in insert mode
      sendInNormalMode: true, // Send message with Enter in normal mode
    };

    // Store customMappings separately from config
    this.customMappings = [];
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

    this.addStyles();
    this.startObserving();
    this.log("VimMotions Started");
  }

  stop() {
    this.log("Stopping VimMotions...");

    // Destroy all Ace editors
    this.aceEditors.forEach((editor, input) => {
      this.destroyAceEditor(input);
    });
    this.aceEditors.clear();
    this.activeInputs.clear();

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    BdApi.DOM.removeStyle("VimMotions");
    BdApi.Patcher.unpatchAll(this.meta.name);

    // Remove Ace from window if we loaded it
    if (window.ace) {
      delete window.ace;
    }
  }

  // ============================================================================
  // Ace Editor Loading
  // ============================================================================

  async loadAceEditor() {
    // Check if Ace is already loaded
    if (window.ace) {
      this.aceLoaded = true;
      return;
    }

    try {
      // Load Ace Editor from CDN
      await this.loadScript(
        "https://cdn.jsdelivr.net/npm/ace-builds@1.43.3/src-min-noconflict/ace.js"
      );

      // Configure Ace
      if (window.ace) {
        window.ace.config.set(
          "basePath",
          "https://cdn.jsdelivr.net/npm/ace-builds@1.43.3/src-min-noconflict/"
        );

        // Load Vim keybindings
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

  // ============================================================================
  // Configuration
  // ============================================================================

  loadConfig() {
    // Load saved config
    const saved = BdApi.Data.load(this.meta.name, "config");

    if (saved) {
      // Extract only the properties we care about, handling nested structure if present
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

      // Load customMappings separately (with backward compatibility)
      this.customMappings =
        saved.customMappings ?? saved.settings?.customMappings ?? [];
    } else {
      this.config = this.defaultConfig;
      this.customMappings = [];
    }

    // Always save to ensure clean format
    this.saveConfig();
  }

  saveConfig() {
    // Save settings and customMappings separately
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
      customMappings: this.customMappings, // Save customMappings separately
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
          // Build new config without customMappings (stored separately)
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
          // customMappings are NOT touched here - they're stored in this.customMappings
          this.saveConfig();

          // Re-apply settings to all active editors
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
            // Update styles first
            this.addStyles();

            // Then update each editor instance
            this.aceEditors.forEach(({ editor }) => {
              this.applyEditorSettings(editor);

              // Force a resize to recalculate layout with new font size
              editor.resize(true);

              // Trigger height recalculation if font size changed
              if (key === "fontSize") {
                editor.renderer.updateFull(true);
                // Manually trigger the height update
                const content = editor.getValue();
                editor.setValue(content + " ", -1);
                setTimeout(() => {
                  editor.setValue(content, -1);
                  editor.navigateFileEnd();
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
          // Font Size
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
                  style: {
                    width: "100%",
                  },
                })
          ),

          // Font Family
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
                  style: {
                    width: "100%",
                  },
                })
          ),

          // Font Color
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

          // Background Color
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

          // Cursor Color
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

          // Highlight Active Line
          React.createElement(
            SettingItem,
            {
              name: "Highlight Active Line",
              note: "Highlight the line where the cursor is",
              inline: true,
            },
            React.createElement(SwitchInput, {
              value: config.highlightActiveLine,
              onChange: (value) => updateConfig("highlightActiveLine", value),
            })
          ),

          // Send in Insert Mode
          React.createElement(
            SettingItem,
            {
              name: "Send with Enter in Insert Mode",
              note: "Send message when pressing Enter in insert mode (Shift+Enter for new line)",
              inline: true,
            },
            React.createElement(SwitchInput, {
              value: config.sendInInsertMode,
              onChange: (value) => updateConfig("sendInInsertMode", value),
            })
          ),

          // Send in Normal Mode
          React.createElement(
            SettingItem,
            {
              name: "Send with Enter in Normal Mode",
              note: "Send message when pressing Enter in normal mode",
              inline: true,
            },
            React.createElement(SwitchInput, {
              value: config.sendInNormalMode,
              onChange: (value) => updateConfig("sendInNormalMode", value),
            })
          ),

          // Debug Mode
          React.createElement(
            SettingItem,
            {
              name: "Debug Mode",
              note: "Show debug messages as toasts",
              inline: true,
            },
            React.createElement(SwitchInput, {
              value: config.debugMode,
              onChange: (value) => updateConfig("debugMode", value),
            })
          ),

          // Custom Key Bindings Section
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

            // List of existing mappings
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

                          // Re-apply mappings to all editors
                          this.aceEditors.forEach(({ editor }) => {
                            this.applyVimMappings(editor);
                          });

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

            // Add new mapping form
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
                        onChange: (value) => setNewMappingKeys(value),
                      })
                    : React.createElement("input", {
                        type: "text",
                        value: newMappingKeys,
                        onChange: (e) => setNewMappingKeys(e.target.value),
                        placeholder: "j",
                        className: "inputDefault-3FGxgL input-2g-os5",
                        style: {
                          width: "100%",
                        },
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
                        onChange: (value) => setNewMappingAction(value),
                      })
                    : React.createElement("input", {
                        type: "text",
                        value: newMappingAction,
                        onChange: (e) => setNewMappingAction(e.target.value),
                        placeholder: "gj",
                        className: "inputDefault-3FGxgL input-2g-os5",
                        style: {
                          width: "100%",
                        },
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
                        {
                          type: "error",
                        }
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

                    // Re-apply mappings to all editors
                    this.aceEditors.forEach(({ editor }) => {
                      this.applyVimMappings(editor);
                    });

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

          // Reset to Defaults Button
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

                  // Re-apply settings to all active editors
                  this.addStyles();
                  this.aceEditors.forEach(({ editor }) => {
                    this.applyEditorSettings(editor);
                    editor.resize(true);
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

  // ============================================================================
  // Styles
  // ============================================================================

  addStyles() {
    const fontSize = this.config?.fontSize || this.defaultConfig.fontSize;
    const fontFamily = this.config?.fontFamily || this.defaultConfig.fontFamily;
    const fontColor = this.config?.fontColor || this.defaultConfig.fontColor;
    const backgroundColor =
      this.config?.backgroundColor || this.defaultConfig.backgroundColor;
    const cursorColor =
      this.config?.cursorColor || this.defaultConfig.cursorColor;

    // Convert hex cursor color to rgba with opacity for block cursor
    const hexToRgba = (hex, alpha) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };
    const cursorColorTransparent = hexToRgba(cursorColor, 0.8);

    // Remove old styles first to ensure clean update
    BdApi.DOM.removeStyle("VimMotions");

    BdApi.DOM.addStyle(
      "VimMotions",
      `
      /* Hide original Discord inputs when Ace is active */
      .vim-ace-wrapper {
        position: relative;
        width: 100%;
        min-height: 44px;
        overflow: visible;
      }
      
      .vim-ace-editor {
        width: 100% !important;
        min-height: 44px;
        position: relative;
      }
      
      .vim-ace-editor .ace_editor {
        font-family: '${fontFamily}', monospace !important;
        font-size: ${fontSize}px !important;
        color: ${fontColor} !important;
        background-color: ${backgroundColor} !important;
        width: 100% !important;
      }
      
      .vim-ace-editor .ace_scroller {
        overflow-y: auto !important;
        overflow-x: hidden !important;
      }
      
      /* Hide scrollbars but keep scroll functionality */
      .vim-ace-editor .ace_scrollbar {
        display: none !important;
      }
      
      .vim-ace-editor .ace_scrollbar-v,
      .vim-ace-editor .ace_scrollbar-h {
        display: none !important;
      }
      
      /* Hide scrollbar for webkit browsers */
      .vim-ace-editor .ace_scroller::-webkit-scrollbar {
        display: none;
        width: 0;
        height: 0;
      }
      
      /* Override background color for all themes to match custom setting */
      .vim-ace-editor .ace_editor,
      .vim-ace-editor .ace_scroller,
      .vim-ace-editor .ace_content {
        background: ${backgroundColor} !important;
        background-color: ${backgroundColor} !important;
      }
      
      /* Add top padding to center text and cursor vertically */
      .vim-ace-editor .ace_content {
        transform: translateY(10px) !important;
      }
      
      /* Override text color to match custom setting - use very specific selectors */
      .vim-ace-editor .ace_line,
      .vim-ace-editor .ace_line > *,
      .vim-ace-editor .ace_line span {
        color: ${fontColor} !important;
      }
      
      /* Force text color on all text tokens */
      .vim-ace-editor .ace_text-layer .ace_line,
      .vim-ace-editor .ace_text-layer .ace_line span {
        color: ${fontColor} !important;
      }
      
      /* Cursor color - proper Ace Editor way using CSS variables */
      .vim-ace-editor .ace_cursor-layer .ace_cursor {
        border-color: ${cursorColor};
      }
      
      /* Cursor styles for Vim insert mode (thin line) */
      .vim-ace-editor.vim-insert-mode .ace_cursor-layer .ace_cursor {
        border-left-width: 2px;
        border-left-color: ${cursorColor};
      }
      
      /* Cursor styles for Vim normal/visual mode (block) */
      .vim-ace-editor.vim-normal-mode .ace_cursor-layer .ace_cursor,
      .vim-ace-editor.vim-visual-mode .ace_cursor-layer .ace_cursor {
        background-color: ${cursorColorTransparent} !important;
      }
      
      /* Make text under cursor fully opaque */
      .vim-ace-editor.vim-normal-mode .ace_cursor-layer .ace_cursor.ace_overwrite-cursors,
      .vim-ace-editor.vim-visual-mode .ace_cursor-layer .ace_cursor.ace_overwrite-cursors {
        color: ${fontColor} !important;
        opacity: 1 !important;
      }
      
      /* Ensure the text content under block cursor is visible */
      .vim-ace-editor.vim-normal-mode .ace_text-layer,
      .vim-ace-editor.vim-visual-mode .ace_text-layer {
        z-index: 2 !important;
      }
      
      .vim-ace-editor.vim-normal-mode .ace_cursor-layer,
      .vim-ace-editor.vim-visual-mode .ace_cursor-layer {
        z-index: 1 !important;
      }
      
      /* Ensure cursor layer respects opacity */
      .vim-ace-editor.vim-normal-mode .ace_cursor-layer,
      .vim-ace-editor.vim-visual-mode .ace_cursor-layer {
        opacity: 1;
      }
      
      /* Ensure background color is applied to gutter area too */
      .vim-ace-editor .ace_gutter {
        background: ${backgroundColor} !important;
        color: ${fontColor} !important;
      }
      
      /* Hide Discord's original input when replaced */
      .vim-hidden-input {
        display: none !important;
      }
    `
    );
  }
  // ============================================================================
  // Input Observation & Ace Editor Management
  // ============================================================================

  startObserving() {
    this.findAndAttachToInputs();

    this.observer = new MutationObserver((mutations) => {
      this.findAndAttachToInputs();
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  findAndAttachToInputs(root = document) {
    // Focus on Discord's main chat input
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
    // Only attach to Discord's main chat input area
    // Avoid attaching to every contenteditable element
    const parent =
      input.closest('[class*="channelTextArea"]') ||
      input.closest('[class*="chatContent"]');
    return parent !== null;
  }

  attachAceEditor(originalInput) {
    if (!this.aceLoaded || !window.ace) {
      this.log("Ace Editor not loaded", "error");
      return;
    }

    try {
      const { editor, editorDiv } = this.createEditor(originalInput);
      const discordModules = this.getDiscordModules();

      this.loadInitialContent(editor, originalInput, discordModules);

      this.setupVimMode(editor, editorDiv, originalInput);

      this.setupContentSync(editor, originalInput);
      this.setupEmojiDetection(editor, originalInput, discordModules);

      this.log("Ace editor attached");
    } catch (e) {
      this.log(`Failed to attach Ace editor: ${e.message}`, "error");
    }
  }

  createEditor(originalInput) {
    // Create wrapper for Ace editor
    const wrapper = document.createElement("div");
    wrapper.className = "vim-ace-wrapper";

    const editorDiv = document.createElement("div");
    editorDiv.className = "vim-ace-editor";
    wrapper.appendChild(editorDiv);

    // Insert wrapper before original input
    originalInput.parentNode.insertBefore(wrapper, originalInput);
    originalInput.classList.add("vim-hidden-input");

    // Initialize Ace editor
    const editor = window.ace.edit(editorDiv);
    this.applyEditorSettings(editor);

    // Get placeholder text from Discord's original input
    const placeholderText = this.getPlaceholderText(originalInput);
    if (placeholderText) {
      this.setPlaceholder(editor, placeholderText);
    }

    // Configure textarea for input
    const textarea = editor.textInput.getElement();
    textarea.tabIndex = 0;
    textarea.style.cssText =
      "opacity:0;position:absolute;z-index:0;height:100%;width:100%;left:0;top:0";
    textarea.removeAttribute("readonly");
    textarea.removeAttribute("disabled");

    // Store reference
    this.aceEditors.set(originalInput, { editor, wrapper });
    this.activeInputs.add(originalInput);

    return { editor, wrapper, editorDiv };
  }

  getDiscordModules() {
    return {
      DraftStore: BdApi.Webpack.getModule(
        (m) => m.getDraft && m.getRecentlyEditedDrafts
      ),
      SelectedChannelStore: BdApi.Webpack.getModule(
        BdApi.Webpack.Filters.byProps("getChannelId", "getVoiceChannelId")
      ),
      DraftActions: BdApi.Webpack.getModule(
        (m) => m.changeDraft || m.saveDraft || m.clearDraft
      ),
    };
  }

  loadInitialDraft(editor, { DraftStore, SelectedChannelStore }) {
    if (DraftStore && SelectedChannelStore) {
      const channelId = SelectedChannelStore.getChannelId();
      const draft = DraftStore.getDraft(channelId, 0);
      if (draft) {
        editor.setValue(draft, -1);
        editor.navigateFileEnd();
        return;
      }
    }
  }

  loadInitialContent(editor, originalInput, discordModules) {
    // First try to get content from the original Discord input (for edit mode)
    const existingContent =
      originalInput.textContent || originalInput.innerText || "";
    if (existingContent.trim()) {
      editor.setValue(existingContent, -1);
      editor.navigateFileEnd();
      this.log(`Loaded existing content: "${existingContent}"`);
      return;
    }

    // If no existing content, try loading draft
    this.loadInitialDraft(editor, discordModules);
  }

  setupVimMode(editor, editorDiv, originalInput) {
    let vimMode = null;
    const textarea = editor.textInput.getElement();
    const keySequences = this.initializeKeySequences();

    // Setup keyboard handling
    textarea.addEventListener("keydown", (e) =>
      this.handleKeydown(e, editor, originalInput, vimMode, keySequences)
    );

    // Enable Vim keybindings after delay
    setTimeout(() => {
      this.log("Setting Vim keyboard handler...");
      editor.setKeyboardHandler("ace/keyboard/vim");
      vimMode = editor.state.cm;

      if (vimMode) {
        this.setupVimModeHandlers(vimMode, editor, textarea);
        this.applyVimMappings(editor);
      }

      // Click handler for focus and insert mode
      editorDiv.addEventListener("click", () =>
        this.handleEditorClick(editor, textarea, vimMode)
      );
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

        // Separate single-key mappings from multi-key sequences
        const singleKeyMappings = [];
        const sequenceMappings = [];

        this.customMappings.forEach((mapping) => {
          // Check if it's a multi-character sequence (like "jk") vs special key (like "<C-e>")
          if (mapping.from.length > 1 && !mapping.from.startsWith("<")) {
            sequenceMappings.push(mapping);
          } else {
            singleKeyMappings.push(mapping);
          }
        });

        // Apply single-key mappings through Vim.map
        singleKeyMappings.forEach((mapping) => {
          try {
            Vim.map(mapping.from, mapping.to, mapping.mode);
            this.log(
              `Applied Vim mapping: ${mapping.from} → ${mapping.to} (${mapping.mode})`
            );
          } catch (e) {
            this.log(
              `Error applying mapping ${mapping.from}: ${e.message}`,
              "error"
            );
          }
        });

        this.log(`Applied ${singleKeyMappings.length} single-key Vim mappings`);
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
    // Get multi-key sequences from customMappings
    const sequences = new Map();
    this.customMappings.forEach((mapping) => {
      // Only process multi-character sequences (not special keys like <C-e>)
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
    // Handle Enter key based on mode
    if (e.key === "Enter" && !e.shiftKey) {
      this.handleEnterKey(e, editor, originalInput, vimMode);
      return;
    }

    // Check for multi-key sequences in insert mode
    if (this.currentMode === "insert" && e.key.length === 1 && keySequences) {
      if (this.handleKeySequence(e, editor, vimMode, keySequences)) {
        return;
      }
    }

    // Vim command keys that trigger mode changes
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

    // Skip insertion if we just entered insert mode via a command
    const shouldSkipInsertion =
      this.justEnteredInsertMode && vimModeChangeKeys.includes(e.key);

    // Manual character insertion in insert mode only
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
      editor.insert(e.key);
      this.log(`Manual insert (insert mode): ${e.key}`);
    } else {
      // Let Vim handle the keys in normal/visual mode or for vim commands
      this.log(`Vim handling (${this.currentMode} mode): ${e.key}`);
    }
  }

  handleKeySequence(e, editor, vimMode, keySequences) {
    const now = Date.now();
    let matchedSequence = null;

    for (const [keys, sequence] of keySequences.entries()) {
      // Only check sequences for the current mode
      if (sequence.mode !== this.currentMode) continue;

      const timeDiff = now - sequence.lastTime;

      // Reset buffer if too much time has passed
      if (timeDiff >= sequence.timeout) {
        sequence.buffer = [];
      }

      // Add current key to buffer
      sequence.buffer.push(e.key);
      sequence.lastTime = now;

      const bufferStr = sequence.buffer.join("");

      // Check for exact match
      if (bufferStr === keys) {
        matchedSequence = { keys, sequence };
        break;
      }

      // Check if buffer is a prefix of the target sequence
      if (!keys.startsWith(bufferStr)) {
        // Not a match, reset to just current key
        sequence.buffer = [e.key];
        // Check if single key could start a sequence
        if (!keys.startsWith(e.key)) {
          sequence.buffer = [];
        }
      }
    }

    if (matchedSequence) {
      const { keys, sequence } = matchedSequence;
      e.preventDefault();
      e.stopPropagation();

      // Remove the typed characters from the editor
      // Note: The current key hasn't been inserted yet (we prevented it),
      // so we only need to remove (keys.length - 1) characters
      const pos = editor.getCursorPosition();
      const charsToRemove = keys.length - 1;

      if (charsToRemove > 0) {
        const startCol = Math.max(0, pos.column - charsToRemove);
        editor.session.remove({
          start: { row: pos.row, column: startCol },
          end: pos,
        });
      }

      // Execute the action
      if (sequence.action === "<Esc>" && vimMode) {
        const vim = vimMode.constructor.Vim;
        if (vim) {
          vim.handleKey(vimMode, "<Esc>", null);
          this.log(`Sequence "${keys}" → exit insert mode`);
        }
      }

      // Clear all buffers after successful match
      for (const seq of keySequences.values()) {
        seq.buffer = [];
        seq.lastTime = 0;
      }

      return true;
    }

    // Check if this could be the start of a sequence
    for (const [keys, sequence] of keySequences.entries()) {
      if (sequence.mode !== this.currentMode) continue;

      const bufferStr = sequence.buffer.join("");
      if (keys.startsWith(bufferStr) && bufferStr.length > 0) {
        // We have a potential sequence starting, don't let the default insert happen yet
        // We'll handle insertion in shouldManuallyInsert if needed
        return false;
      }
    }

    return false;
  }

  handleEnterKey(e, editor, originalInput, vimMode) {
    // Check if we're in edit mode by looking for the operations/cancel/save UI
    const isEditMode = this.isEditMode(originalInput);

    const shouldSendInInsert =
      this.config.sendInInsertMode && this.currentMode === "insert";
    const shouldSendInNormal =
      this.config.sendInNormalMode && this.currentMode !== "insert";

    if (shouldSendInInsert || shouldSendInNormal) {
      // Send message
      e.preventDefault();
      e.stopPropagation();

      const content = editor.getValue().trim();
      if (!content) {
        this.log("No content to send");
        return;
      }

      if (isEditMode) {
        this.editMessage(content, e, originalInput);

        this.log(`Enter in ${this.currentMode} mode: message edited`);
      } else {
        this.sendMessage(content);

        editor.setValue("", -1);

        const vim = vimMode.constructor.Vim;
        if (vim) vim.handleKey(vimMode, "i", null);

        this.syncToDiscordInput(originalInput, "");

        this.log(`Enter in ${this.currentMode} mode: message sent`);
      }
    } else {
      // Insert new line (default behavior in insert mode)
      this.log(`Enter in ${this.currentMode} mode: new line`);
    }
  }

  setupVimModeHandlers(vimMode, editor, textarea) {
    vimMode.on("vim-mode-change", (data) => {
      const previousMode = this.currentMode;
      this.currentMode = data.mode;
      this.log(`Vim mode changed: ${data.mode}`);

      // Track mode change from normal to insert - this means a command like 'a', 'i', 'o' was just used
      if (previousMode === "normal" && data.mode === "insert") {
        this.justEnteredInsertMode = true;
        // Clear the flag after a short delay
        setTimeout(() => {
          this.justEnteredInsertMode = false;
        }, 50);
      }

      // Update cursor style based on mode
      const editorDiv = editor.container.closest(".vim-ace-editor");
      if (editorDiv) {
        // Remove all mode classes
        editorDiv.classList.remove(
          "vim-insert-mode",
          "vim-normal-mode",
          "vim-visual-mode"
        );

        // Add current mode class
        if (data.mode === "insert") {
          editorDiv.classList.add("vim-insert-mode");
        } else if (data.mode === "visual") {
          editorDiv.classList.add("vim-visual-mode");
        } else {
          editorDiv.classList.add("vim-normal-mode");
        }
      }

      if (this.onModeChange) this.onModeChange();
    });

    setTimeout(() => {
      const vim = vimMode.constructor.Vim;
      if (vim) {
        vim.handleKey(vimMode, "i", null);
        this.log("Switched to insert mode on initialization");
        editor.focus();
        textarea.focus();

        // Set initial mode class
        const editorDiv = editor.container.closest(".vim-ace-editor");
        if (editorDiv) {
          editorDiv.classList.add("vim-insert-mode");
        }
      }
    }, 100);
  }

  handleEditorClick(editor, textarea, vimMode) {
    editor.focus();
    textarea.focus();
    setTimeout(() => {
      if (vimMode && this.currentMode !== "insert") {
        const vim = vimMode.constructor.Vim;
        if (vim) vim.handleKey(vimMode, "i", null);
      }
    }, 10);
  }

  setupContentSync(editor, originalInput) {
    let isSyncingFromDiscord = false;

    // Sync editor changes to Discord's visible input
    editor.session.on("change", () => {
      if (isSyncingFromDiscord) return;
      this.syncToDiscordInput(originalInput, editor.getValue());
    });

    // Shift+Enter for new line
    editor.commands.addCommand({
      name: "newLine",
      bindKey: { win: "Shift-Enter", mac: "Shift-Enter" },
      exec: (editor) => editor.insert("\n"),
    });

    // Store sync flag for emoji detection
    this.aceEditors.get(originalInput).isSyncingFromDiscord = () =>
      isSyncingFromDiscord;
    this.aceEditors.get(originalInput).setSyncFlag = (value) =>
      (isSyncingFromDiscord = value);
  }

  setupEmojiDetection(
    editor,
    originalInput,
    { DraftStore, SelectedChannelStore, DraftActions }
  ) {
    if (!DraftStore || !SelectedChannelStore || !DraftActions) {
      this.log("Discord modules not found, emoji detection disabled", "warn");
      return;
    }

    const editorData = this.aceEditors.get(originalInput);

    const checkDraftStore = () => {
      if (editorData.isSyncingFromDiscord()) return;

      const channelId = SelectedChannelStore.getChannelId();
      const currentDraft = DraftStore.getDraft(channelId, 0) || "";

      if (currentDraft) {
        editorData.setSyncFlag(true);

        editor.insert(currentDraft);
        this.log(`Inserted emoji: "${currentDraft}"`);

        try {
          DraftActions.clearDraft(channelId, 0);
        } catch (e) {
          this.log(`Error clearing draft: ${e.message}`);
        }

        editorData.setSyncFlag(false);
      }
    };

    const inputObserver = new MutationObserver(checkDraftStore);
    const pollInterval = setInterval(checkDraftStore, 100);

    inputObserver.observe(originalInput, {
      characterData: true,
      childList: true,
      subtree: true,
    });

    // Update stored editor data with cleanup references
    this.aceEditors.set(originalInput, {
      ...editorData,
      observer: inputObserver,
      pollInterval: pollInterval,
    });
  }

  applyEditorSettings(editor) {
    const fontSize = this.config?.fontSize || 14;
    const fontFamily = this.config?.fontFamily || "Consolas";
    const fontColor = this.config?.fontColor || "#dcddde";
    const backgroundColor = this.config?.backgroundColor || "#2f3136";
    const highlightActiveLine = this.config?.highlightActiveLine ?? false;

    editor.setOptions({
      // Theme and appearance
      theme: `ace/theme/dracula`, // Use a fixed dark theme that works well with Discord
      fontSize: fontSize,
      fontFamily: fontFamily,

      // Display options
      showPrintMargin: false,
      highlightActiveLine: highlightActiveLine,
      showLineNumbers: false,
      showGutter: false,
      displayIndentGuides: false,

      // Wrapping
      wrap: true,
      indentedSoftWrap: false, // Prevent indentation on wrapped lines

      // Scrolling
      scrollPastEnd: 0,
      hScrollBarAlwaysVisible: false,
      vScrollBarAlwaysVisible: false,

      // Behavior
      readOnly: false,
      highlightSelectedWord: false,
      enableBasicAutocompletion: true,
      enableLiveAutocompletion: false,

      // Performance
      animatedScroll: false,

      // Tab behavior
      useSoftTabs: true,
      tabSize: 2,

      // Copy/paste
      copyWithEmptySelection: true,
    });

    // Additional renderer settings
    editor.renderer.setShowGutter(false);
    editor.renderer.setScrollMargin(8, 8, 0, 0);

    // Set cursor color properly using Ace's API
    const cursorColor = this.config?.cursorColor || "#ffffff";
    editor.renderer.$cursorLayer.config.cursorColor = cursorColor;

    // Override theme colors with custom colors
    // This must be done after the theme is loaded
    setTimeout(() => {
      const editorElement = editor.container;
      if (editorElement) {
        // Set custom CSS variables for colors
        editorElement.style.setProperty("--ace-background", backgroundColor);
        editorElement.style.setProperty("--ace-foreground", fontColor);
        editorElement.style.setProperty("--ace-cursor-color", cursorColor);

        // Force background and foreground colors
        const styleElement = editorElement.querySelector(".ace_editor");
        if (styleElement) {
          styleElement.style.backgroundColor = backgroundColor;
          styleElement.style.color = fontColor;
        }

        const contentElement = editorElement.querySelector(".ace_scroller");
        if (contentElement) {
          contentElement.style.backgroundColor = backgroundColor;
        }

        // Force text color on all text lines
        const textLayer = editorElement.querySelector(".ace_text-layer");
        if (textLayer) {
          textLayer.style.color = fontColor;
          // Apply to all line elements
          const lines = textLayer.querySelectorAll(".ace_line");
          lines.forEach((line) => {
            line.style.color = fontColor;
            // Apply to all spans within lines
            const spans = line.querySelectorAll("span");
            spans.forEach((span) => {
              span.style.color = fontColor;
            });
          });
        }
      }
    }, 10);

    // Function to update editor height based on content (including wrapped lines)
    const updateHeight = () => {
      // Force layout update
      editor.renderer.updateFull();

      const lineHeight = editor.renderer.lineHeight || 20;

      // Count screen rows (includes wrapped lines) instead of document lines
      const screenRows = editor.session.getScreenLength();

      // Determine if we have multiple lines (including wrapped)
      const hasMultipleLines = screenRows > 1;

      // Calculate actual content height including wrapped lines
      const contentHeight = screenRows * lineHeight;
      const topPadding = 10; // Top padding from translateY
      const bottomPadding = hasMultipleLines ? 10 : 0; // Bottom padding only for multi-line
      const totalPadding = topPadding + bottomPadding + 10; // 20 for comfort

      const minHeight = 44;
      const maxHeight = Math.floor(window.innerHeight * 0.5);

      const newHeight = Math.max(
        minHeight,
        Math.min(contentHeight + totalPadding, maxHeight)
      );

      // Update container height
      editor.container.style.height = `${newHeight}px`;

      // Update bottom padding dynamically
      const content = editor.container.querySelector(".ace_content");
      if (content) {
        content.style.paddingBottom = hasMultipleLines ? "10px" : "0px";
      }

      // Find and update Discord's parent containers
      const discordTextArea = editor.container.closest('[class*="textArea"]');
      if (discordTextArea) {
        discordTextArea.style.height = `${newHeight}px`;
      }

      const channelTextArea = editor.container.closest(
        '[class*="channelTextArea"]'
      );
      if (channelTextArea) {
        // Let the channel text area adjust naturally
        channelTextArea.style.minHeight = `${newHeight}px`;
      }

      // Tell Ace to recalculate its layout
      editor.resize(true);
    };

    // Listen to changes and update editor size
    editor.session.on("change", () => {
      // Delay slightly to ensure renderer has updated
      setTimeout(updateHeight, 10);
    });

    // Initial size calculation
    setTimeout(updateHeight, 100);
  }

  syncToDiscordInput(originalInput, content) {
    // Update Discord's input to trigger their state management
    originalInput.textContent = content;

    // Dispatch input event to notify Discord
    const event = new Event("input", { bubbles: true, cancelable: true });
    originalInput.dispatchEvent(event);
  }

  sendMessage(content) {
    try {
      if (!content || !content.trim()) {
        this.log("No content to send");
        return;
      }

      // Get Discord's message sending module
      const MessageActions = BdApi.Webpack.getModule(
        (m) => m.sendMessage && m.receiveMessage
      );

      // Get the current channel ID
      const SelectedChannelStore = BdApi.Webpack.getModule(
        BdApi.Webpack.Filters.byProps("getChannelId", "getVoiceChannelId")
      );

      const channelId = SelectedChannelStore?.getChannelId();
      if (!channelId) {
        this.log("Could not get channel ID", "error");
        return;
      }

      this.log(
        `Attempting to send message to channel ${channelId}: "${content}"`
      );

      // Send the message using Discord's internal API
      // The correct format requires a message object with specific structure
      if (MessageActions && MessageActions.sendMessage) {
        MessageActions.sendMessage(
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
      } else {
        this.log("Could not find MessageActions module", "error");
        this.log(`MessageActions: ${MessageActions}`);
      }
    } catch (error) {
      this.log(`Error sending message: ${error.message}`, "error");
      console.error("[VimMotions] Full error:", error);
    }
  }

  isEditMode(originalInput) {
    // Check if we're in edit mode by looking for the operations container
    const container = originalInput.closest('[class*="channelTextArea"]');
    if (!container) return false;

    // Look for the "escape to cancel • enter to save" UI
    const parent = container.parentElement;
    if (!parent) return false;

    const operations = parent.querySelector('[class*="operations"]');

    this.log(`isEditMode: ${operations !== null}`);

    return operations !== null;
  }

  editMessage(content, e, originalInput) {
    try {
      // Target the message DOM element from the event
      const messageDiv = e?.target?.closest
        ? e.target.closest("li > [class^=message]")
        : null;

      if (!messageDiv) {
        this.log("Cannot find message element", "error");
        return;
      }

      // Get React internal instance for the message element
      const instance = BdApi.ReactUtils.getInternalInstance(messageDiv);
      if (!instance) {
        this.log("Cannot find React instance for message", "error");
        return;
      }

      const walkable = ["child", "memoizedProps", "sibling"];

      // Try to locate the message object (baseMessage preferred)
      const messageObj =
        BdApi.Utils.findInTree(instance, (m) => m?.baseMessage, { walkable })
          ?.baseMessage ??
        BdApi.Utils.findInTree(instance, (m) => m?.message, { walkable })
          ?.message;

      if (!messageObj) {
        this.log("Cannot find message data in React tree", "error");
        return;
      }

      const messageId = messageObj.id;
      const channelId = messageObj.channel_id;
      if (!messageId || !channelId) {
        this.log("Cannot determine message or channel ID", "error");
        return;
      }

      const MessageStore = BdApi.Webpack.getModule(
        BdApi.Webpack.Filters.byKeys("receiveMessage", "editMessage")
      );
      if (!MessageStore || !MessageStore.editMessage) {
        this.log("Cannot find MessageStore.editMessage", "error");
        return;
      }

      this.log(
        `Editing message ${messageId} in channel ${channelId} with content: ${content}`
      );

      // Call Discord's internal edit API
      MessageStore.editMessage(channelId, messageId, { content });
    } catch (err) {
      this.log(`Failed to edit message: ${err?.message || err}`, "error");
    }
  }

  destroyAceEditor(originalInput) {
    const editorData = this.aceEditors.get(originalInput);
    if (editorData) {
      const { editor, wrapper, observer, pollInterval, emojiClickListener } =
        editorData;

      // Disconnect observer if it exists
      if (observer) {
        observer.disconnect();
      }

      // Clear polling interval if it exists
      if (pollInterval) {
        clearInterval(pollInterval);
      }

      // Destroy Ace editor
      editor.destroy();

      // Remove wrapper
      if (wrapper && wrapper.parentNode) {
        wrapper.parentNode.removeChild(wrapper);
      }

      // Show original input
      originalInput.classList.remove("vim-hidden-input");
      this.aceEditors.delete(originalInput);
    }
  }

  getPlaceholderText(originalInput) {
    // Try to find placeholder from Discord's structure
    const container = originalInput.closest('[class*="channelTextArea"]');
    if (container) {
      const placeholder = container.querySelector('[class*="placeholder"]');
      if (placeholder) {
        return placeholder.textContent || placeholder.innerText;
      }
    }
    // Fallback placeholder
    return "Message #channel";
  }

  setPlaceholder(editor, placeholderText) {
    // Create a placeholder div that shows when editor is empty
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

    // Show/hide placeholder based on editor content
    const updatePlaceholder = () => {
      const isEmpty = editor.getValue().trim() === "";
      placeholderDiv.style.display = isEmpty ? "block" : "none";
    };

    // Initial check
    updatePlaceholder();

    // Update on content change
    editor.session.on("change", updatePlaceholder);
  }

  // ============================================================================
  // Logging
  // ============================================================================

  log(message, type = "info") {
    console.log(`[VimMotions] ${message}`);
    if (this.config?.debugMode) {
      BdApi.UI.showToast(`[VimMotions] ${message}`, { type });
    }
  }
};
