// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using XiHan.PrintClient.Core.Consent;
using XiHan.PrintClient.Core.Server;

namespace XiHan.PrintClient.Core.Tests.Consent;

public sealed class ConsentTests : IDisposable
{
    private const string Origin = "https://erp.example.com";
    private readonly string _directory = Directory.CreateTempSubdirectory("xihan-print-consent-").FullName;

    public void Dispose() => Directory.Delete(_directory, recursive: true);

    private string FilePath(string name) => Path.Combine(_directory, name);

    [Fact]
    public void OriginListsPersistAndKeepEachOriginInOneList()
    {
        var lists = new OriginLists(FilePath("origins.json"));
        var changes = 0;
        lists.Changed += () => changes++;

        lists.Allow(Origin);
        lists.Deny(Origin);
        lists.Deny(Origin);
        lists.Allow("http://localhost:5173");

        var reloaded = new OriginLists(FilePath("origins.json"));
        Assert.Equal(["http://localhost:5173"], reloaded.Allowed);
        Assert.Equal([Origin], reloaded.Denied);
        Assert.Equal(3, changes);

        reloaded.Forget(Origin);
        Assert.Empty(new OriginLists(FilePath("origins.json")).Denied);
    }

    [Fact]
    public void OriginListsNormalizeAndSkipInvalidEntriesWhenLoading()
    {
        File.WriteAllText(FilePath("origins.json"), """{"allowed":["HTTPS://ERP.example.com","not an origin"],"denied":["https://erp.example.com","http://x.test"]}""");

        var lists = new OriginLists(FilePath("origins.json"));

        Assert.Equal([Origin], lists.Allowed);
        Assert.Equal(["http://x.test"], lists.Denied);
    }

    [Fact]
    public void OriginListsTreatAnUnreadableFileAsEmpty()
    {
        File.WriteAllText(FilePath("origins.json"), "{ broken");

        Assert.Empty(new OriginLists(FilePath("origins.json")).Allowed);
    }

    [Fact]
    public void PolicyDefaultsWhenTheFileIsMissingOrBroken()
    {
        Assert.Same(ClientPolicy.Default, ClientPolicy.Load(FilePath("missing.json")));
        File.WriteAllText(FilePath("broken.json"), "[");
        Assert.Same(ClientPolicy.Default, ClientPolicy.Load(FilePath("broken.json")));
        Assert.True(ClientPolicy.Default.PromptForUnknownOrigins);
        Assert.True(ClientPolicy.Default.CheckForUpdates);
    }

    [Fact]
    public void PolicyReadsCommentsAndSkipsInvalidEntries()
    {
        File.WriteAllText(FilePath("policy.json"), """
            {
              // 企业预先放行的业务系统
              "allowedOrigins": ["https://ERP.example.com", "ftp://bad"],
              "promptForUnknownOrigins": false,
              "ports": [17630, 70000],
              "updates": { "check": false, "manifestUrls": ["https://updates.example.com/client.json", "http://insecure"] },
            }
            """);

        var policy = ClientPolicy.Load(FilePath("policy.json"));

        Assert.Equal([Origin], policy.AllowedOrigins);
        Assert.False(policy.PromptForUnknownOrigins);
        Assert.Equal([17630], policy.Ports);
        Assert.False(policy.CheckForUpdates);
        Assert.Equal(["https://updates.example.com/client.json"], policy.UpdateManifestUrls);
    }

    private OriginAuthorizer Authorizer(FakePrompt prompt, ClientPolicy? policy = null, TimeSpan? timeout = null)
    {
        return new OriginAuthorizer(new OriginLists(FilePath("origins.json")), policy ?? ClientPolicy.Default, prompt, timeout);
    }

    private static async Task<(ConsentDecision Decision, int Notified)> AuthorizeAsync(OriginAuthorizer authorizer, string origin = Origin)
    {
        var notified = 0;
        var decision = await authorizer.AuthorizeAsync(origin, () =>
        {
            notified++;
            return Task.CompletedTask;
        }, TestContext.Current.CancellationToken);
        return (decision, notified);
    }

    [Fact]
    public async Task AllowsPolicyOriginsWithoutPrompting()
    {
        var prompt = new FakePrompt(ConsentChoice.Deny);
        var authorizer = Authorizer(prompt, new ClientPolicy { AllowedOrigins = [Origin] });

        Assert.Equal((ConsentDecision.Allowed, 0), await AuthorizeAsync(authorizer));
        Assert.Equal(0, prompt.Asked);
    }

    [Fact]
    public async Task RemembersAllowAndDenyAlwaysButNotOnceOrPlainDeny()
    {
        var prompt = new FakePrompt(ConsentChoice.AllowOnce);
        var authorizer = Authorizer(prompt);
        Assert.Equal((ConsentDecision.Allowed, 1), await AuthorizeAsync(authorizer));
        prompt.Choice = ConsentChoice.Deny;
        Assert.Equal((ConsentDecision.Denied, 1), await AuthorizeAsync(authorizer));
        prompt.Choice = ConsentChoice.Allow;
        Assert.Equal((ConsentDecision.Allowed, 1), await AuthorizeAsync(authorizer));
        Assert.Equal((ConsentDecision.Allowed, 0), await AuthorizeAsync(authorizer));
        Assert.Equal(3, prompt.Asked);

        prompt.Choice = ConsentChoice.DenyAlways;
        Assert.Equal((ConsentDecision.Denied, 1), await AuthorizeAsync(authorizer, "https://other.example.com"));
        Assert.Equal((ConsentDecision.Denied, 0), await AuthorizeAsync(authorizer, "https://other.example.com"));
        Assert.Equal(4, prompt.Asked);
    }

    [Fact]
    public async Task DeniesUnknownOriginsWhenPolicyDisablesPrompting()
    {
        var prompt = new FakePrompt(ConsentChoice.Allow);

        Assert.Equal((ConsentDecision.Denied, 0), await AuthorizeAsync(Authorizer(prompt, new ClientPolicy { PromptForUnknownOrigins = false })));
        Assert.Equal(0, prompt.Asked);
    }

    [Fact]
    public async Task TimesOutWhenNobodyAnswers()
    {
        var prompt = new FakePrompt(null);

        Assert.Equal((ConsentDecision.TimedOut, 1), await AuthorizeAsync(Authorizer(prompt, timeout: TimeSpan.FromMilliseconds(100))));
    }

    [Fact]
    public async Task SharesOnePromptBetweenConnectionsFromTheSameOrigin()
    {
        var gate = new TaskCompletionSource<ConsentChoice>();
        var prompt = new FakePrompt(null) { Gate = gate };
        var authorizer = Authorizer(prompt);

        var first = AuthorizeAsync(authorizer);
        var second = AuthorizeAsync(authorizer);
        await Task.Delay(50, TestContext.Current.CancellationToken);
        gate.SetResult(ConsentChoice.AllowOnce);

        Assert.Equal((ConsentDecision.Allowed, 1), await first);
        Assert.Equal((ConsentDecision.Allowed, 1), await second);
        Assert.Equal(1, prompt.Asked);
    }

    private sealed class FakePrompt(ConsentChoice? choice) : IConsentPrompt
    {
        public ConsentChoice? Choice { get; set; } = choice;

        public TaskCompletionSource<ConsentChoice>? Gate { get; init; }

        public int Asked { get; private set; }

        public async Task<ConsentChoice> AskAsync(string origin, CancellationToken cancellationToken)
        {
            Asked++;
            if (Gate is not null)
                return await Gate.Task.WaitAsync(cancellationToken);
            if (Choice is { } value)
                return value;
            await Task.Delay(Timeout.Infinite, cancellationToken);
            throw new InvalidOperationException();
        }
    }
}
