package main

import (
    "fmt"
    "log"
    "os"
    "net/http"
)

func handler(w http.ResponseWriter, r *http.Request) {
		country := os.Getenv("CLOUDFLARE_COUNTRY_A2")
		location := os.Getenv("CLOUDFLARE_LOCATION")
		region :=os.Getenv("CLOUDFLARE_REGION")

    fmt.Fprintf(w, "Hi, I'm a container running with my version v3 in %s, %s, which is part of %s ", location, country, region)
}

func main() {
    http.HandleFunc("/", handler)
    log.Fatal(http.ListenAndServe(":8080", nil))
}
