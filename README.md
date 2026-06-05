# Orca Swap Integration Tests

### Running Tests
To run the integration tests on your local validator / Surfpool setup:
```bash
yarn test:orca
```

> [!TIP]
> After the first deployment, you can append `--skip-deploy` to avoid redeploying the program and speed up execution, which is especially helpful when testing with Surfpool:
> ```bash
> yarn test:orca --skip-deploy
> ```
