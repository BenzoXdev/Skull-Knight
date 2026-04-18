#!/usr/bin/env python3
"""
Skull Knight - Open GitHub on launch
Opens the benzoXdev GitHub profile in the default browser.
"""

import webbrowser

GITHUB_URL = "https://github.com/benzoXdev"

def main():
    print("[Skull Knight] Opening GitHub: " + GITHUB_URL)
    webbrowser.open(GITHUB_URL)

if __name__ == "__main__":
    main()
