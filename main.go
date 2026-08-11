package main

import (
	"embed"
	"log"

	"github.com/leeha/codexgui/backend"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app, err := backend.NewApp()
	if err != nil {
		log.Fatal(err)
	}
	err = wails.Run(&options.App{
		Title: "Codex GUI", Width: 1180, Height: 780, MinWidth: 840, MinHeight: 600,
		AssetServer: &assetserver.Options{Assets: assets},
		OnStartup:   app.Startup, OnShutdown: app.Shutdown,
		Bind: []interface{}{app},
	})
	if err != nil {
		log.Fatal(err)
	}
}
