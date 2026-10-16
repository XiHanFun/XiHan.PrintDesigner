// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

namespace XiHan.PrintClient.Core.Tests;

public sealed class ClientDefaultsTests
{
    [Fact]
    public void SubProtocolCarriesMajorVersion()
    {
        Assert.Equal(ClientDefaults.SubProtocol, $"xihan-print.v{ClientDefaults.ProtocolVersion}");
    }

    [Fact]
    public void PortsAreTriedInOrderFrom17620()
    {
        Assert.Equal([17620, 17621, 17622, 17623], ClientDefaults.Ports);
    }
}
