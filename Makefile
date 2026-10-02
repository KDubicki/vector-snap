.DEFAULT_GOAL := help

BACKEND_DIR := backend
FRONTEND_DIR := frontend
# Keep in sync with the image bundled by hadolint/hadolint-action in the workflows.
HADOLINT_IMAGE := ghcr.io/hadolint/hadolint:v2.15.1-debian

.PHONY: help up down logs install install-backend install-frontend dev-backend dev-frontend lint lint-backend lint-frontend typecheck typecheck-backend typecheck-frontend test test-backend test-frontend hooks lint-commits ci ci-act lint-docker

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

up: ## Build and start the full stack with Docker Compose
	docker compose up --build

down: ## Stop the Docker Compose stack
	docker compose down

logs: ## Follow logs of all services
	docker compose logs -f

install: install-backend install-frontend ## Install all local dependencies

install-backend: ## Install backend dependencies (requires an active virtualenv)
	cd $(BACKEND_DIR) && pip install -e ".[dev]"

install-frontend: ## Install frontend dependencies
	cd $(FRONTEND_DIR) && npm install

dev-backend: ## Run the backend with auto-reload
	cd $(BACKEND_DIR) && uvicorn app.main:app --reload --port 8000

dev-frontend: ## Run the frontend dev server
	cd $(FRONTEND_DIR) && npm run dev

lint: lint-backend lint-frontend ## Lint everything

lint-backend: ## Lint and check formatting of the backend
	cd $(BACKEND_DIR) && ruff check . && ruff format --check .

lint-frontend: ## Lint the frontend
	cd $(FRONTEND_DIR) && npm run lint && npm run format:check

typecheck: typecheck-backend typecheck-frontend ## Type-check everything

typecheck-backend: ## Type-check the backend
	cd $(BACKEND_DIR) && mypy app tests

typecheck-frontend: ## Type-check the frontend
	cd $(FRONTEND_DIR) && npm run typecheck

test: test-backend test-frontend ## Run all tests

test-backend: ## Run backend tests
	cd $(BACKEND_DIR) && pytest --cov

test-frontend: ## Run frontend tests
	cd $(FRONTEND_DIR) && npm run test:coverage

hooks: ## Enable repository git hooks (commit message validation)
	git config core.hooksPath .githooks

lint-commits: ## Validate commit messages on the current branch against origin/main
	scripts/lint-commits.sh --from origin/main --to HEAD --verbose

ci: lint lint-docker typecheck test ## Run the main CI checks locally (native tools)

lint-docker: ## Lint Dockerfiles with the same hadolint version as CI
	docker run --rm -v "$(CURDIR):/repo" -w /repo $(HADOLINT_IMAGE) hadolint -c .hadolint.yaml backend/Dockerfile frontend/Dockerfile

ci-act: ## Run the full GitHub Actions CI workflow locally in containers (requires act)
	act workflow_dispatch -W .github/workflows/ci.yml --concurrent-jobs 1 \
		-P ubuntu-24.04=catthehacker/ubuntu:act-24.04
