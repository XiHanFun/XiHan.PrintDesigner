// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

namespace XiHan.PrintClient.Windows.Tests;

public sealed class WindowsAppPathsTests
{
    [Fact]
    public void PlacesEachKindOfDataUnderItsOwnRoot()
    {
        var paths = new WindowsAppPaths(@"C:\roaming", @"C:\local", @"C:\machine");

        Assert.Equal(@"C:\roaming\XiHanFun\PrintClient", paths.SettingsDirectory);
        Assert.Equal(@"C:\local\XiHanFun\PrintClient\logs", paths.LogDirectory);
        Assert.Equal(@"C:\local\XiHanFun\PrintClient\webview", paths.RendererDataDirectory);
        Assert.Equal(@"C:\local\XiHanFun\PrintClient\updates", paths.UpdateDirectory);
        Assert.Equal(@"C:\machine\XiHanFun\PrintClient\policy.json", paths.PolicyFile);
    }
}
