.PHONY: build check demo

build:
	npm run build
	npm run build:native

check:
	npm run check

demo:
	swift run AppKitInspectorDemo
