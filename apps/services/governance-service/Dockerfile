FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY GovernanceService.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app
COPY --from=build /app .
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
# .NET imajlarindaki yerlesik root olmayan kullanici (UID 1654).
USER $APP_UID
ENTRYPOINT ["dotnet", "GovernanceService.dll"]
